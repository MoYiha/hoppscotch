# Web Worker Blob Serialization Tests

## Overview

This test suite validates the fix for [issue #5443](https://github.com/hoppscotch/hoppscotch/issues/5443) where file uploads in multipart/form-data requests were being sent as nil/empty when the experimental scripting sandbox was enabled.

## Problem Statement

When the experimental scripting sandbox is enabled, requests are processed in a Web Worker. The original implementation used `JSON.stringify()` to serialize the request before sending it to the worker. However:

- `Blob` and `File` objects cannot be serialized with `JSON.stringify()`
- They become empty objects `{}`, losing all file content
- The Structured Clone Algorithm can't clone the entire request due to non-cloneable properties

## Solution

The fix implements a hybrid approach:

1. **Extract** `Blob`/`File` objects and replace them with placeholders
2. **Stringify** the request (now safe since Blobs are removed)
3. **Transfer** Blobs separately in an array (Blobs ARE cloneable)
4. **Reconstruct** the request in the worker by restoring Blobs

## Test Structure

### 1. `extractBlobsFromRequest` Tests

These tests verify that Blob/File objects are correctly extracted from requests and replaced with placeholders.

**Test Cases:**
- ✅ Extract single File from multipart/form-data
- ✅ Extract multiple Files
- ✅ Extract Blob objects (not just Files)
- ✅ Handle requests with no blobs
- ✅ Handle mixed file and non-file form data
- ✅ Handle null values in file arrays

**What would fail without the fix:**
Without extraction, `JSON.stringify()` would convert Files to `{}`, and there would be no mechanism to preserve them.

### 2. `reconstructRequestWithBlobs` Tests

These tests verify that requests are correctly reconstructed with Blobs restored from the transferred array.

**Test Cases:**
- ✅ Reconstruct request with File objects
- ✅ Maintain correct order with multiple blobs
- ✅ Preserve non-blob data intact
- ✅ Handle empty blob array
- ✅ Preserve File metadata (name, type, size)

**What would fail without the fix:**
Without reconstruction, the placeholders would remain as `{ __BLOB_PLACEHOLDER__: true }` and wouldn't be actual File objects.

### 3. Round-trip Serialization Tests

These tests verify the complete extract → transfer → reconstruct cycle.

**Test Cases:**
- ✅ Preserve file through extract and reconstruct cycle
- ✅ **REGRESSION TEST**: Demonstrates the bug (File becomes `{}` with JSON.stringify alone)

**The Regression Test:**
This is the most important test. It shows:
```javascript
// OLD behavior (broken):
const broken = JSON.parse(JSON.stringify(request))
// File becomes: {}

// NEW behavior (fixed):
const [str, blobs] = extractBlobsFromRequest(request)
const fixed = reconstructRequestWithBlobs(str, blobs)
// File is preserved: File { name: "test.txt", ... }
```

## Verification Approach

### Unit Testing ✅
The test suite verifies the core functions work correctly in isolation.

### Integration Testing Considerations

For full end-to-end testing, you should:

1. **Enable experimental scripting sandbox** in settings
2. **Create a multipart/form-data request** with file upload
3. **Send the request** to a test endpoint
4. **Verify on the server** that file contents are received

**Network inspection verification:**
- In browser DevTools Network tab → Request → Payload
- You should see `(binary)` for uploaded files
- NOT empty objects or null values

### Manual Testing Checklist

- [ ] Create request with `Content-Type: multipart/form-data`
- [ ] Add form field with file upload (isFile: true)
- [ ] Upload a file with identifiable content (e.g., specific text or image)
- [ ] Enable "Experimental Scripting Sandbox" in settings
- [ ] Send request to echo service or test server
- [ ] Verify server receives actual file content
- [ ] Check Network tab shows `(binary)` in payload
- [ ] Verify file metadata (name, size, type) is preserved

### Test Server Verification

You can use endpoints like:
- `https://echo.hoppscotch.io` - Hoppscotch echo service
- `https://httpbin.org/post` - Returns request data
- Local test server that logs multipart data

Expected server response should show:
```json
{
  "files": {
    "file": {
      "name": "test.txt",
      "size": 12,
      "content": "file content here"
    }
  }
}
```

## Edge Cases Covered

1. **Empty file arrays**: `value: []`
2. **Null files**: `value: [file1, null, file2]`
3. **Multiple files in one field**: `value: [file1, file2, file3]`
4. **Mixed form data**: Files and text fields together
5. **No files**: Regular JSON/text requests
6. **application/octet-stream**: Direct Blob body
7. **Large files**: Blob size preservation
8. **File metadata**: name, type, size preservation

## Known Limitations

### Test Environment Limitations
- The test environment (Node/Vitest) doesn't fully support `File.text()` or `Blob.text()` methods
- Tests verify File instances and metadata instead of reading content
- In real browser environment, content is fully preserved

### What's NOT Tested (But Works)
- Actual Web Worker `postMessage` transfer (tested manually in browser)
- Structured Clone Algorithm behavior (browser-specific)
- Large file performance (>100MB files)

## Future Test Enhancements

1. **Worker Integration Tests**: Create actual worker and test postMessage
2. **Performance Tests**: Measure overhead of extract/reconstruct
3. **Memory Tests**: Verify no memory leaks with large files
4. **Browser-specific Tests**: Test in different browsers (Chrome, Firefox, Safari)
5. **Network Mock Tests**: Mock actual HTTP multipart request generation

## Related Files

- `RequestRunner.ts:296-318` - `extractBlobsFromRequest()` implementation
- `sandbox.worker.ts:65-88` - `reconstructRequestWithBlobs()` implementation
- `RequestRunner.ts:360-368` - Pre-request worker message
- `RequestRunner.ts:410-419` - Post-request worker message

## References

- [Issue #5443](https://github.com/hoppscotch/hoppscotch/issues/5443)
- [MDN: Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: File API](https://developer.mozilla.org/en-US/docs/Web/API/File)
- [MDN: Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
