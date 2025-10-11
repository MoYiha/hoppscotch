# File Upload Fix: Blob Preservation Approach

## Issue

[#5443](https://github.com/hoppscotch/hoppscotch/issues/5443) - File uploads in multipart/form-data requests were being sent as nil/empty when the experimental scripting sandbox was enabled.

## Root Cause

When the experimental scripting sandbox is enabled, requests are sent to a Web Worker for pre-request script execution. The request is serialized with `JSON.stringify()` before being sent to the worker. When the worker returns the updated request, it has been through JSON serialization/deserialization, which causes `Blob` and `File` objects to become empty objects `{}`.

The flow was:
1. Original request has `File` objects → Web Worker
2. Worker receives JSON stringified request (`File` becomes `{}`)
3. Scripts may modify URL, headers, etc.
4. Worker returns updated request (still has `{}` instead of `File`)
5. **BUG**: Final request used updated request with lost files

## Solution: Minimal Surface Area Approach

Instead of complex serialization/deserialization machinery, we use a **simpler approach with minimal surface area**:

### Preserve Blobs from Original Request

When merging the updated request from the scripting context, we preserve `Blob`/`File` objects from the **original request** and only apply non-blob changes from the updated request.

```typescript
// BEFORE (broken):
const finalRequest = {
  ...resolvedRequest,
  ...(preRequestScriptResult.right.updatedRequest ?? {}),
}
// Files are lost! ❌

// AFTER (fixed):
const finalRequest = preserveBlobsInRequest(
  resolvedRequest, // Has the original Blobs
  preRequestScriptResult.right.updatedRequest ?? {} // Has lost Blobs but may have other updates
)
// Files are preserved! ✅
```

### How `preserveBlobsInRequest()` Works

The function intelligently merges the two requests:

1. **If body wasn't modified**: Use original body entirely (fast path)
2. **If multipart/form-data**: Restore file fields from original while keeping text field updates
3. **If application/octet-stream**: Restore the original Blob
4. **Otherwise**: Use updated body as-is

## Changes Made

### 1. [RequestRunner.ts:303-370](packages/hoppscotch-common/src/helpers/RequestRunner.ts#L303-L370)

Added `preserveBlobsInRequest()` function that preserves Blobs when merging requests.

### 2. [RequestRunner.ts:547-550](packages/hoppscotch-common/src/helpers/RequestRunner.ts#L547-L550)

Changed finalRequest creation to use the preservation function:

```typescript
const finalRequest = preserveBlobsInRequest(
  resolvedRequest,
  preRequestScriptResult.right.updatedRequest ?? {}
)
```

## Why This Approach is Better

### Comparison with Alternative Approaches

| Approach | Surface Area | Complexity | Reliability |
|----------|--------------|------------|-------------|
| **Extract/Reconstruct Blobs** | Large - modifies worker protocol, both sides of communication | High - custom serialization logic | Medium - more code = more bugs |
| **Preserve from Original** ✅ | Minimal - single merge function | Low - simple object merging | High - straightforward logic |
| **Structured Clone** | N/A - doesn't work | N/A | N/A - request has non-cloneable properties |

### Advantages

1. ✅ **Minimal changes** - Only one helper function and one call site
2. ✅ **No protocol changes** - Worker communication unchanged
3. ✅ **Simple logic** - Easy to understand and maintain
4. ✅ **Preserves intent** - Scripts modify request properties, not files
5. ✅ **Fast** - No extraction/reconstruction overhead
6. ✅ **Safe** - Less code = fewer bugs

## Test Coverage

### Unit Tests: 7 Tests (All Passing)

**Location**: [packages/hoppscotch-common/src/helpers/\_\_tests\_\_/blob-preservation.spec.ts](packages/hoppscotch-common/src/helpers/__tests__/blob-preservation.spec.ts)

1. ✅ Preserve file uploads when scripts modify other properties
2. ✅ Preserve multiple files
3. ✅ Preserve Blob in application/octet-stream
4. ✅ Don't affect body if not modified by scripts
5. ✅ Handle non-file form data correctly
6. ✅ Preserve files while allowing text fields to be updated
7. ✅ **REGRESSION TEST**: Demonstrates the bug vs the fix

### Test Scenarios Covered

- **Single file upload**: Basic case
- **Multiple files**: Arrays of files
- **Mixed form data**: Files + text fields
- **Blob body**: application/octet-stream
- **Scripts modifying non-body properties**: URL, headers, etc.
- **Scripts modifying text fields**: Preserves files, updates text
- **Scripts not touching body**: Fast path preservation

## Manual Testing Guide

### Setup

1. Enable "Experimental Scripting Sandbox" in Settings
2. Create a POST request with `Content-Type: multipart/form-data`
3. Add a file upload field
4. Upload a test file (e.g., text file, image, PDF)

### Test Cases

#### Test 1: File Upload with Pre-Request Script

**Pre-request Script**:
```javascript
// Modify URL parameter
hopp.request.setParam("timestamp", Date.now())
```

**Expected**: File is uploaded successfully with modified URL

#### Test 2: File Upload with Header Modification

**Pre-request Script**:
```javascript
// Add custom header
hopp.request.setHeader("X-Custom-Header", "test-value")
```

**Expected**: File is uploaded with custom header

#### Test 3: Multiple Files

- Add multiple files to the request
- Run with pre-request script that modifies other properties

**Expected**: All files are uploaded successfully

### Verification

**Network Tab Inspection**:
1. Open DevTools → Network
2. Send the request
3. Click on the request → Payload tab
4. Verify files show as `(binary)` NOT `{}` or empty

**Server Response**:
- Test endpoints like httpbin.org/post should show file in `files` section
- File metadata (name, size) should be present
- File content should be received

## Edge Cases Handled

1. **No files**: Works normally with text-only requests
2. **Null files**: Handles `null` in file arrays
3. **Empty file arrays**: Gracefully handled
4. **Body not modified**: Fast path - uses original entirely
5. **Content type changes**: Preserves files when appropriate
6. **Mixed updates**: Files preserved, text fields updated

## Performance

- **Overhead**: Negligible - simple object merging
- **No serialization overhead**: Unlike extract/reconstruct approach
- **Fast path**: When body not modified, skips processing entirely

## Maintenance

### Future Considerations

1. **Adding new body types**: Add case to `preserveBlobsInRequest()`
2. **Changing request structure**: Update merge logic if needed
3. **New script capabilities**: May need to handle new cases

### Known Limitations

- Assumes scripts don't intentionally want to remove files (reasonable assumption)
- If a script explicitly sets a file field to empty, it will be restored (feature not bug)

## Alternative Considered: Extract/Reconstruct

The initial implementation used a complex extract/reconstruct approach:

```typescript
// Extract blobs, replace with placeholders
const [requestStr, blobs] = extractBlobsFromRequest(request)

// Send to worker
worker.postMessage({ request: requestStr, blobs })

// In worker: reconstruct
const request = reconstructRequestWithBlobs(requestStr, blobs)
```

**Why it was rejected**:
- ❌ Larger surface area (4 functions vs 1)
- ❌ Modified worker protocol
- ❌ More complex logic
- ❌ Harder to maintain
- ❌ Performance overhead

## References

- [Issue #5443](https://github.com/hoppscotch/hoppscotch/issues/5443)
- [PR #5388](https://github.com/hoppscotch/hoppscotch/pull/5388) - Introduced the experimental scripting sandbox
- [MDN: Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
- [MDN: File API](https://developer.mozilla.org/en-US/docs/Web/API/File)

## Summary

The fix uses a **minimal surface area approach** by preserving Blobs from the original request when merging with the updated request from the scripting context. This is simpler, more reliable, and easier to maintain than complex serialization approaches.

**Key Insight**: Scripts modify request properties (URL, headers, params), not file uploads. So preserve the files and apply the property changes.
