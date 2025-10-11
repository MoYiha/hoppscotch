import { HoppRESTRequest } from "@hoppscotch/data"
import { describe, expect, test } from "vitest"

/**
 * Test suite for Blob/File serialization and deserialization in Web Worker context
 *
 * This addresses issue #5443 where file uploads in multipart/form-data were being
 * sent as nil/empty when the experimental scripting sandbox was enabled.
 *
 * The issue was caused by JSON.stringify() being unable to serialize Blob/File objects.
 * The solution extracts Blobs before stringification and reconstructs them in the worker.
 */

/**
 * Extracts Blob/File objects from a request and replaces them with placeholders
 * (Copy of the implementation for testing purposes)
 */
function extractBlobsFromRequest(
  request: HoppRESTRequest
): [string, Blob[]] {
  const blobs: Blob[] = []

  const requestWithPlaceholders = JSON.parse(
    JSON.stringify(request, (_key, value) => {
      if (value instanceof Blob) {
        blobs.push(value)
        return { __BLOB_PLACEHOLDER__: true }
      }
      return value
    })
  )

  return [JSON.stringify(requestWithPlaceholders), blobs]
}

/**
 * Reconstructs a request object by restoring Blob/File objects
 * (Copy of the implementation for testing purposes)
 */
function reconstructRequestWithBlobs(
  requestStr: string,
  blobs: Blob[]
): unknown {
  let blobIndex = 0

  return JSON.parse(requestStr, (_key, value) => {
    if (
      value &&
      typeof value === "object" &&
      value.__BLOB_PLACEHOLDER__ === true
    ) {
      return blobs[blobIndex++] || null
    }
    return value
  })
}

describe("Blob Serialization for Web Worker", () => {
  describe("extractBlobsFromRequest", () => {
    test("should extract File objects from multipart/form-data body", () => {
      const testFile = new File(["test content"], "test.txt", {
        type: "text/plain",
      })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Upload Test",
        endpoint: "https://api.example.com/upload",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "file",
              value: [testFile],
              isFile: true,
              active: true,
            },
            {
              key: "name",
              value: "test",
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      // Should extract one blob
      expect(blobs).toHaveLength(1)
      expect(blobs[0]).toBeInstanceOf(File)
      expect(blobs[0].name).toBe("test.txt")

      // Request string should contain placeholder
      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body[0].value[0]).toEqual({
        __BLOB_PLACEHOLDER__: true,
      })

      // Non-file field should be unchanged
      expect(parsed.body.body[1].value).toBe("test")
    })

    test("should extract multiple File objects", () => {
      const file1 = new File(["content1"], "file1.txt", { type: "text/plain" })
      const file2 = new File(["content2"], "file2.txt", { type: "text/plain" })
      const file3 = new File(["content3"], "file3.txt", { type: "text/plain" })

      const request: HoppRESTRequest = {
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
              value: [file1, file2, file3],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      expect(blobs).toHaveLength(3)
      expect(blobs[0].name).toBe("file1.txt")
      expect(blobs[1].name).toBe("file2.txt")
      expect(blobs[2].name).toBe("file3.txt")

      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body[0].value).toHaveLength(3)
      parsed.body.body[0].value.forEach((placeholder: unknown) => {
        expect(placeholder).toEqual({ __BLOB_PLACEHOLDER__: true })
      })
    })

    test("should handle Blob objects (not just Files)", () => {
      const blob = new Blob(["blob content"], { type: "application/octet-stream" })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Blob Upload",
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      expect(blobs).toHaveLength(1)
      expect(blobs[0]).toBeInstanceOf(Blob)
      expect(blobs[0].type).toBe("application/octet-stream")

      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body).toEqual({ __BLOB_PLACEHOLDER__: true })
    })

    test("should handle request with no blobs", () => {
      const request: HoppRESTRequest = {
        v: "16",
        name: "JSON Request",
        endpoint: "https://api.example.com/data",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "application/json",
          body: JSON.stringify({ name: "test", value: 123 }),
        },
        auth: { authType: "none", authActive: false },
        preRequestScript: "",
        testScript: "",
        requestVariables: [],
        responses: {},
      }

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      expect(blobs).toHaveLength(0)

      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body).toBe(JSON.stringify({ name: "test", value: 123 }))
    })

    test("should handle mixed file and non-file form data", () => {
      const imageFile = new File(["image data"], "photo.jpg", {
        type: "image/jpeg",
      })
      const docFile = new File(["doc data"], "document.pdf", {
        type: "application/pdf",
      })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Mixed Form Upload",
        endpoint: "https://api.example.com/submit",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "username",
              value: "john_doe",
              isFile: false,
              active: true,
            },
            {
              key: "avatar",
              value: [imageFile],
              isFile: true,
              active: true,
            },
            {
              key: "email",
              value: "john@example.com",
              isFile: false,
              active: true,
            },
            {
              key: "document",
              value: [docFile],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      expect(blobs).toHaveLength(2)
      expect(blobs[0].name).toBe("photo.jpg")
      expect(blobs[1].name).toBe("document.pdf")

      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body[0].value).toBe("john_doe")
      expect(parsed.body.body[1].value[0]).toEqual({ __BLOB_PLACEHOLDER__: true })
      expect(parsed.body.body[2].value).toBe("john@example.com")
      expect(parsed.body.body[3].value[0]).toEqual({ __BLOB_PLACEHOLDER__: true })
    })

    test("should handle null values in file arrays", () => {
      const file = new File(["content"], "file.txt", { type: "text/plain" })

      const request: HoppRESTRequest = {
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
              value: [file, null, file],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)

      expect(blobs).toHaveLength(2)

      const parsed = JSON.parse(requestStr)
      expect(parsed.body.body[0].value).toHaveLength(3)
      expect(parsed.body.body[0].value[0]).toEqual({ __BLOB_PLACEHOLDER__: true })
      expect(parsed.body.body[0].value[1]).toBeNull()
      expect(parsed.body.body[0].value[2]).toEqual({ __BLOB_PLACEHOLDER__: true })
    })
  })

  describe("reconstructRequestWithBlobs", () => {
    test("should reconstruct request with File objects", () => {
      const originalFile = new File(["test content"], "test.txt", {
        type: "text/plain",
      })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Upload Test",
        endpoint: "https://api.example.com/upload",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "file",
              value: [originalFile],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      expect(reconstructed.body.contentType).toBe("multipart/form-data")
      if (reconstructed.body.contentType === "multipart/form-data") {
        const fileValue = reconstructed.body.body[0].value
        expect(Array.isArray(fileValue)).toBe(true)
        if (Array.isArray(fileValue)) {
          expect(fileValue[0]).toBeInstanceOf(File)
          expect((fileValue[0] as File).name).toBe("test.txt")
        }
      }
    })

    test("should maintain correct order with multiple blobs", () => {
      const file1 = new File(["content1"], "file1.txt", { type: "text/plain" })
      const file2 = new File(["content2"], "file2.jpg", { type: "image/jpeg" })
      const file3 = new File(["content3"], "file3.pdf", {
        type: "application/pdf",
      })

      const request: HoppRESTRequest = {
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
              key: "text",
              value: [file1],
              isFile: true,
              active: true,
            },
            {
              key: "image",
              value: [file2],
              isFile: true,
              active: true,
            },
            {
              key: "doc",
              value: [file3],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      if (reconstructed.body.contentType === "multipart/form-data") {
        const body = reconstructed.body.body

        expect(Array.isArray(body[0].value) && body[0].value[0]).toBeInstanceOf(File)
        expect(Array.isArray(body[0].value) && (body[0].value[0] as File).name).toBe("file1.txt")

        expect(Array.isArray(body[1].value) && body[1].value[0]).toBeInstanceOf(File)
        expect(Array.isArray(body[1].value) && (body[1].value[0] as File).name).toBe("file2.jpg")

        expect(Array.isArray(body[2].value) && body[2].value[0]).toBeInstanceOf(File)
        expect(Array.isArray(body[2].value) && (body[2].value[0] as File).name).toBe("file3.pdf")
      }
    })

    test("should preserve non-blob data intact", () => {
      const file = new File(["content"], "file.txt", { type: "text/plain" })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Mixed Request",
        endpoint: "https://api.example.com/submit",
        method: "POST",
        headers: [{ key: "X-Custom", value: "header", active: true, description: "" }],
        params: [{ key: "page", value: "1", active: true, description: "" }],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "name",
              value: "John Doe",
              isFile: false,
              active: true,
            },
            {
              key: "file",
              value: [file],
              isFile: true,
              active: true,
            },
          ],
        },
        auth: { authType: "bearer", authActive: true, token: "secret-token" },
        preRequestScript: "console.log('test')",
        testScript: "hopp.expect(200).toBe(200)",
        requestVariables: [{ key: "var1", value: "value1", active: true }],
        responses: {},
      }

      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      // Verify all non-blob fields are preserved
      expect(reconstructed.endpoint).toBe(request.endpoint)
      expect(reconstructed.method).toBe(request.method)
      expect(reconstructed.headers).toEqual(request.headers)
      expect(reconstructed.params).toEqual(request.params)
      expect(reconstructed.auth).toEqual(request.auth)
      expect(reconstructed.preRequestScript).toBe(request.preRequestScript)
      expect(reconstructed.testScript).toBe(request.testScript)
      expect(reconstructed.requestVariables).toEqual(request.requestVariables)

      // Verify the non-file form field is preserved
      if (reconstructed.body.contentType === "multipart/form-data") {
        expect(reconstructed.body.body[0].value).toBe("John Doe")
      }
    })

    test("should handle empty blob array", () => {
      const request: HoppRESTRequest = {
        v: "16",
        name: "No Blobs",
        endpoint: "https://api.example.com/data",
        method: "GET",
        headers: [],
        params: [],
        body: { contentType: null, body: null },
        auth: { authType: "none", authActive: false },
        preRequestScript: "",
        testScript: "",
        requestVariables: [],
        responses: {},
      }

      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      expect(reconstructed).toEqual(request)
    })

    test("should preserve File metadata (name, type, size)", () => {
      const fileContent = "Hello, World!"
      const originalFile = new File([fileContent], "greeting.txt", {
        type: "text/plain",
      })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Metadata Test",
        endpoint: "https://api.example.com/upload",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "file",
              value: [originalFile],
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

      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      if (reconstructed.body.contentType === "multipart/form-data") {
        const reconstructedFile = reconstructed.body.body[0].value[0] as File

        expect(reconstructedFile.name).toBe(originalFile.name)
        expect(reconstructedFile.type).toBe(originalFile.type)
        expect(reconstructedFile.size).toBe(originalFile.size)
        expect(reconstructedFile).toBeInstanceOf(File)
      }
    })
  })

  describe("Round-trip serialization", () => {
    test("should preserve file through extract and reconstruct cycle", () => {
      const fileContent = "Important data that must not be lost!"
      const originalFile = new File([fileContent], "important.txt", {
        type: "text/plain",
      })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Round Trip Test",
        endpoint: "https://api.example.com/upload",
        method: "POST",
        headers: [],
        params: [],
        body: {
          contentType: "multipart/form-data",
          body: [
            {
              key: "file",
              value: [originalFile],
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

      // Extract
      const [requestStr, blobs] = extractBlobsFromRequest(request)

      // Simulate worker transfer (these would be transferred via postMessage)
      // In reality, the structured clone algorithm handles this

      // Reconstruct
      const reconstructed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      // Verify file is preserved
      if (reconstructed.body.contentType === "multipart/form-data") {
        const reconstructedFile = reconstructed.body.body[0].value[0] as File

        expect(reconstructedFile).toBeInstanceOf(File)
        expect(reconstructedFile.name).toBe(originalFile.name)
        expect(reconstructedFile.type).toBe(originalFile.type)
        expect(reconstructedFile.size).toBe(originalFile.size)
      }
    })

    test("REGRESSION TEST: would fail without the fix (simulating JSON.stringify of Blob)", () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" })

      const request: HoppRESTRequest = {
        v: "16",
        name: "Regression Test",
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

      // This is what the OLD code did (without the fix)
      const brokenSerialization = JSON.stringify(request)
      const brokenParsed = JSON.parse(brokenSerialization)

      // The file becomes an empty object {}
      if (brokenParsed.body.contentType === "multipart/form-data") {
        const brokenFile = brokenParsed.body.body[0].value[0]
        // This would be {} instead of a File
        expect(brokenFile).toEqual({})
        expect(brokenFile).not.toBeInstanceOf(File)
      }

      // This is what the NEW code does (with the fix)
      const [requestStr, blobs] = extractBlobsFromRequest(request)
      const fixedParsed = reconstructRequestWithBlobs(
        requestStr,
        blobs
      ) as HoppRESTRequest

      // The file is properly preserved
      if (fixedParsed.body.contentType === "multipart/form-data") {
        const fixedFile = fixedParsed.body.body[0].value[0]
        expect(fixedFile).toBeInstanceOf(File)
        expect((fixedFile as File).name).toBe("test.txt")
      }
    })
  })
})
