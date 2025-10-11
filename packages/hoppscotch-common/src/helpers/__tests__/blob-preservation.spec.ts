import { HoppRESTRequest } from "@hoppscotch/data"
import { describe, expect, test } from "vitest"

/**
 * Test suite for Blob/File preservation when merging requests after scripting context
 *
 * This addresses issue #5443 where file uploads in multipart/form-data were being
 * sent as nil/empty when the experimental scripting sandbox was enabled.
 *
 * The simpler solution: Instead of complex serialization/deserialization, we preserve
 * the original Blobs when merging the updated request from the scripting context.
 */

/**
 * Preserves Blob/File objects from the original request body when merging with updated request
 * (Copy of implementation for testing purposes)
 */
function preserveBlobsInRequest(
  originalRequest: HoppRESTRequest,
  updatedRequest: Partial<HoppRESTRequest>
): HoppRESTRequest {
  // If the body wasn't modified by scripts, preserve the original (with Blobs)
  if (!updatedRequest.body) {
    return { ...originalRequest, ...updatedRequest }
  }

  // If body was modified but it's multipart/form-data, we need to preserve Blobs
  if (
    originalRequest.body.contentType === "multipart/form-data" &&
    updatedRequest.body.contentType === "multipart/form-data"
  ) {
    const originalBody = originalRequest.body.body
    const updatedBody = updatedRequest.body.body

    // Restore Blobs from original request to updated body
    const mergedBody = updatedBody.map((updatedField, index) => {
      const originalField = originalBody[index]

      // If original field was a file field, restore it
      // Note: After JSON serialization, file fields become text fields due to Zod transform
      // (empty file array gets converted to isFile: false, value: "")
      // So we check the ORIGINAL field, not the updated one
      if (originalField && originalField.isFile) {
        // Restore the original file field completely
        return {
          ...updatedField,
          value: originalField.value,
          isFile: true as const,
        }
      }

      return updatedField
    })

    return {
      ...originalRequest,
      ...updatedRequest,
      body: {
        contentType: "multipart/form-data" as const,
        body: mergedBody as typeof originalBody,
        showIndividualContentType: updatedRequest.body.showIndividualContentType,
        isBulkEditing: updatedRequest.body.isBulkEditing,
      },
    }
  }

  // If body is application/octet-stream with a Blob, preserve it
  if (
    originalRequest.body.contentType === "application/octet-stream" &&
    updatedRequest.body.contentType === "application/octet-stream" &&
    originalRequest.body.body instanceof Blob
  ) {
    return {
      ...originalRequest,
      ...updatedRequest,
      body: {
        ...updatedRequest.body,
        body: originalRequest.body.body, // Preserve the original Blob
      },
    }
  }

  // For other body types, use the updated body as-is
  return { ...originalRequest, ...updatedRequest }
}

describe("Blob Preservation in Request Merge", () => {
  test("should preserve file uploads when scripts modify other properties", () => {
    const file = new File(["test content"], "test.txt", { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Upload Request",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: [file],
            isFile: true,
            active: true,
          },
          {
            key: "name",
            value: "John",
            isFile: false,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    // Simulate what comes back from scripting context (JSON serialized and parsed)
    // Files become empty objects during JSON.stringify/parse
    // Then Zod transform converts empty file arrays to text fields
    const updatedRequest: Partial<HoppRESTRequest> = {
      endpoint: "https://api.example.com/upload?modified=true", // Script changed URL
      headers: [
        { key: "X-Custom", value: "header", active: true, description: "" },
      ],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: "", // Lost during serialization! Zod converted to text field
            isFile: false, // Zod transform changed this!
            active: true,
          },
          {
            key: "name",
            value: "John",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    // URL and headers should be updated
    expect(mergedRequest.endpoint).toBe(
      "https://api.example.com/upload?modified=true"
    )
    expect(mergedRequest.headers).toHaveLength(1)
    expect(mergedRequest.headers[0].key).toBe("X-Custom")

    // BUT file should be preserved from original!
    expect(mergedRequest.body.contentType).toBe("multipart/form-data")
    if (mergedRequest.body.contentType === "multipart/form-data") {
      const fileField = mergedRequest.body.body[0]
      expect(fileField.isFile).toBe(true)
      if (fileField.isFile && Array.isArray(fileField.value)) {
        expect(fileField.value).toHaveLength(1)
        expect(fileField.value[0]).toBeInstanceOf(File)
        expect((fileField.value[0] as File).name).toBe("test.txt")
      }
    }
  })

  test("should preserve multiple files", () => {
    const file1 = new File(["content1"], "file1.txt", { type: "text/plain" })
    const file2 = new File(["content2"], "file2.txt", { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Multi Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "files",
            value: [file1, file2],
            isFile: true,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    const updatedRequest: Partial<HoppRESTRequest> = {
      method: "PUT", // Script changed method
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "files",
            value: [], // Lost!
            isFile: true,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    expect(mergedRequest.method).toBe("PUT")

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const filesField = mergedRequest.body.body[0]
      if (filesField.isFile && Array.isArray(filesField.value)) {
        expect(filesField.value).toHaveLength(2)
        expect((filesField.value[0] as File).name).toBe("file1.txt")
        expect((filesField.value[1] as File).name).toBe("file2.txt")
      }
    }
  })

  test("should preserve Blob in application/octet-stream", () => {
    const blob = new Blob(["binary content"], {
      type: "application/octet-stream",
    })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Binary Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "application/octet-stream",
        body: blob,
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    const updatedRequest: Partial<HoppRESTRequest> = {
      headers: [{ key: "X-Test", value: "value", active: true, description: "" }],
      body: {
        contentType: "application/octet-stream",
        body: null, // Lost during serialization
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    expect(mergedRequest.headers).toHaveLength(1)
    expect(mergedRequest.body.contentType).toBe("application/octet-stream")
    if (mergedRequest.body.contentType === "application/octet-stream") {
      expect(mergedRequest.body.body).toBeInstanceOf(Blob)
      expect(mergedRequest.body.body).toBe(blob)
    }
  })

  test("should not affect body if not modified by scripts", () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: [file],
            isFile: true,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    // Script only modified URL, not body
    const updatedRequest: Partial<HoppRESTRequest> = {
      endpoint: "https://api.example.com/modified",
      // No body property
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    expect(mergedRequest.endpoint).toBe("https://api.example.com/modified")

    // Body should be completely untouched
    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body).toBe(originalRequest.body)
    }
  })

  test("should handle non-file form data correctly", () => {
    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Form Request",
      endpoint: "https://api.example.com/form",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "name",
            value: "John",
            isFile: false,
            active: true,
          },
          {
            key: "email",
            value: "john@example.com",
            isFile: false,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    const updatedRequest: Partial<HoppRESTRequest> = {
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "name",
            value: "Jane", // Changed by script
            isFile: false,
            active: true,
          },
          {
            key: "email",
            value: "john@example.com",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body.body[0].value).toBe("Jane") // Updated value
    }
  })

  test("should preserve files while allowing text fields to be updated", () => {
    const file = new File(["content"], "document.pdf", {
      type: "application/pdf",
    })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Mixed Form",
      endpoint: "https://api.example.com/submit",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "document",
            value: [file],
            isFile: true,
            active: true,
          },
          {
            key: "title",
            value: "Original Title",
            isFile: false,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    const updatedRequest: Partial<HoppRESTRequest> = {
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "document",
            value: [], // Lost
            isFile: true,
            active: true,
          },
          {
            key: "title",
            value: "Updated Title", // Changed by script
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      // File preserved
      const docField = mergedRequest.body.body[0]
      if (docField.isFile && Array.isArray(docField.value)) {
        expect(docField.value[0]).toBeInstanceOf(File)
        expect((docField.value[0] as File).name).toBe("document.pdf")
      }

      // Title updated
      const titleField = mergedRequest.body.body[1]
      if (!titleField.isFile) {
        expect(titleField.value).toBe("Updated Title")
      }
    }
  })

  test("REGRESSION TEST: demonstrates the problem without the fix", () => {
    const file = new File(["content"], "test.txt", { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: [file],
            isFile: true,
            active: true,
          },
        ],
      },
      auth: { authType: "none", authActive: false },
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }

    // This is what the OLD approach did (simple spread merge)
    const brokenUpdatedRequest = JSON.parse(JSON.stringify(originalRequest))
    const brokenMerge = { ...originalRequest, ...brokenUpdatedRequest }

    // File is lost in the broken merge (becomes an empty object {})
    if (brokenMerge.body.contentType === "multipart/form-data") {
      const brokenFileField = brokenMerge.body.body[0]
      expect(brokenFileField.value).toEqual([{}]) // File becomes {} after JSON serialization!
      expect(brokenFileField.value[0]).not.toBeInstanceOf(File)
    }

    // This is what the NEW approach does
    const fixedMerge = preserveBlobsInRequest(
      originalRequest,
      brokenUpdatedRequest
    )

    // File is preserved in the fixed merge
    if (fixedMerge.body.contentType === "multipart/form-data") {
      const fixedFileField = fixedMerge.body.body[0]
      if (fixedFileField.isFile && Array.isArray(fixedFileField.value)) {
        expect(fixedFileField.value[0]).toBeInstanceOf(File)
        expect((fixedFileField.value[0] as File).name).toBe("test.txt")
      }
    }
  })
})
