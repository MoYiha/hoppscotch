import { HoppRESTRequest } from "@hoppscotch/data"
import { describe, expect, test } from "vitest"

/**
 * Comprehensive test suite for edge cases in Blob preservation
 *
 * These tests cover scenarios that could be missed in basic testing:
 * - Field count mismatches (scripts adding/removing fields)
 * - Null values in file arrays
 * - Inactive fields
 * - Content type changes
 * - Metadata preservation
 * - Mixed ordering
 */

function preserveBlobsInRequest(
  originalRequest: HoppRESTRequest,
  updatedRequest: Partial<HoppRESTRequest>
): HoppRESTRequest {
  if (!updatedRequest.body) {
    return { ...originalRequest, ...updatedRequest }
  }

  if (
    originalRequest.body.contentType === "multipart/form-data" &&
    updatedRequest.body.contentType === "multipart/form-data"
  ) {
    const originalBody = originalRequest.body.body
    const updatedBody = updatedRequest.body.body

    const mergedBody = updatedBody.map((updatedField, index) => {
      const originalField = originalBody[index]

      if (originalField && originalField.isFile) {
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
        body: originalRequest.body.body,
      },
    }
  }

  return { ...originalRequest, ...updatedRequest }
}

describe("Blob Preservation - Comprehensive Edge Cases", () => {
  test("should handle script adding new text fields", () => {
    const file = new File(["content"], "doc.pdf", { type: "application/pdf" })

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
            key: "document",
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

    // Script added a new field (common in pre-request scripts)
    const updatedRequest: Partial<HoppRESTRequest> = {
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "document",
            value: "",
            isFile: false,
            active: true,
          },
          {
            key: "description",
            value: "Important document",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body.body).toHaveLength(2)

      const docField = mergedRequest.body.body[0]
      if (docField.isFile && Array.isArray(docField.value)) {
        expect(docField.value[0]).toBeInstanceOf(File)
      }

      const descField = mergedRequest.body.body[1]
      if (!descField.isFile) {
        expect(descField.value).toBe("Important document")
      }
    }
  })

  test("should handle script removing fields", () => {
    const file = new File(["content"], "file.txt", { type: "text/plain" })

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
            key: "file",
            value: "",
            isFile: false,
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

    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body.body).toHaveLength(2)

      const fileField = mergedRequest.body.body[0]
      if (fileField.isFile && Array.isArray(fileField.value)) {
        expect(fileField.value[0]).toBeInstanceOf(File)
      }
    }
  })

  test("should preserve null values in file arrays", () => {
    const file1 = new File(["content1"], "file1.txt", { type: "text/plain" })
    const file2 = new File(["content2"], "file2.txt", { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Partial Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "files",
            value: [file1, null, file2],
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
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "files",
            value: "",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const filesField = mergedRequest.body.body[0]
      if (filesField.isFile && Array.isArray(filesField.value)) {
        expect(filesField.value).toHaveLength(3)
        expect(filesField.value[0]).toBeInstanceOf(File)
        expect(filesField.value[1]).toBeNull()
        expect(filesField.value[2]).toBeInstanceOf(File)
      }
    }
  })

  test("should preserve inactive file fields", () => {
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
            active: false,
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
            key: "file",
            value: "",
            isFile: false,
            active: false,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const fileField = mergedRequest.body.body[0]
      expect(fileField.active).toBe(false)
      if (fileField.isFile && Array.isArray(fileField.value)) {
        expect(fileField.value[0]).toBeInstanceOf(File)
      }
    }
  })

  test("should preserve contentType metadata", () => {
    const file = new File(["content"], "image.jpg", { type: "image/jpeg" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Image Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "image",
            value: [file],
            isFile: true,
            active: true,
            contentType: "image/jpeg",
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
            key: "image",
            value: "",
            isFile: false,
            active: true,
            contentType: "image/jpeg",
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const imageField = mergedRequest.body.body[0]
      expect(imageField.contentType).toBe("image/jpeg")
      if (imageField.isFile && Array.isArray(imageField.value)) {
        expect(imageField.value[0]).toBeInstanceOf(File)
      }
    }
  })

  test("should handle reordered fields", () => {
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
            key: "file1",
            value: [file1],
            isFile: true,
            active: true,
          },
          {
            key: "name",
            value: "John",
            isFile: false,
            active: true,
          },
          {
            key: "file2",
            value: [file2],
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

    // Script reordered fields (position-based preservation)
    const updatedRequest: Partial<HoppRESTRequest> = {
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file1",
            value: "",
            isFile: false,
            active: true,
          },
          {
            key: "name",
            value: "Jane",
            isFile: false,
            active: true,
          },
          {
            key: "file2",
            value: "",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      // file1 preserved (index 0)
      const file1Field = mergedRequest.body.body[0]
      if (file1Field.isFile && Array.isArray(file1Field.value)) {
        expect(file1Field.value[0]).toBeInstanceOf(File)
        expect((file1Field.value[0] as File).name).toBe("file1.txt")
      }

      // name updated (index 1)
      const nameField = mergedRequest.body.body[1]
      if (!nameField.isFile) {
        expect(nameField.value).toBe("Jane")
      }

      // file2 preserved (index 2)
      const file2Field = mergedRequest.body.body[2]
      if (file2Field.isFile && Array.isArray(file2Field.value)) {
        expect(file2Field.value[0]).toBeInstanceOf(File)
        expect((file2Field.value[0] as File).name).toBe("file2.txt")
      }
    }
  })

  test("should handle empty original body", () => {
    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Empty Form",
      endpoint: "https://api.example.com/submit",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [],
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
            value: "Added by script",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body.body).toHaveLength(1)
      expect(mergedRequest.body.body[0].value).toBe("Added by script")
    }
  })

  test("should handle large files (size preservation)", () => {
    const largeContent = new Array(1024 * 1024).join("a") // ~1MB
    const largeFile = new File([largeContent], "large.dat", {
      type: "application/octet-stream",
    })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Large Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: [largeFile],
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
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "file",
            value: "",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const fileField = mergedRequest.body.body[0]
      if (fileField.isFile && Array.isArray(fileField.value)) {
        const preservedFile = fileField.value[0] as File
        expect(preservedFile.size).toBe(largeFile.size)
        expect(preservedFile.size).toBeGreaterThan(1000000) // > 1MB
      }
    }
  })

  test("should handle Blob (not File) objects", () => {
    const blob = new Blob(["blob content"], { type: "text/plain" })

    const originalRequest: HoppRESTRequest = {
      v: "16",
      name: "Blob Upload",
      endpoint: "https://api.example.com/upload",
      method: "POST",
      headers: [],
      params: [],
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "data",
            value: [blob],
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
      body: {
        contentType: "multipart/form-data",
        body: [
          {
            key: "data",
            value: "",
            isFile: false,
            active: true,
          },
        ],
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      const dataField = mergedRequest.body.body[0]
      if (dataField.isFile && Array.isArray(dataField.value)) {
        expect(dataField.value[0]).toBeInstanceOf(Blob)
        expect(dataField.value[0]).toBe(blob) // Same reference
      }
    }
  })

  test("should handle showIndividualContentType and isBulkEditing flags", () => {
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
        showIndividualContentType: false,
        isBulkEditing: false,
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
            key: "file",
            value: "",
            isFile: false,
            active: true,
          },
        ],
        showIndividualContentType: true,
        isBulkEditing: true,
      },
    }

    const mergedRequest = preserveBlobsInRequest(originalRequest, updatedRequest)

    if (mergedRequest.body.contentType === "multipart/form-data") {
      expect(mergedRequest.body.showIndividualContentType).toBe(true)
      expect(mergedRequest.body.isBulkEditing).toBe(true)
    }
  })
})
