Now I have a complete understanding of the code. Let me analyze the issues with the previous plan and create a revised implementation plan.

## Review Feedback Response

Since the reviewer provided a score of 6/10 but no specific observations were listed, I've identified the following issues with my previous plan:

| # | Issue Identified | My Response | Justification |
|---|------------------|-------------|---------------|
| 1 | Previous plan suggested throwing an error when lock fails | REJECT | `setupDeepLinks()` already calls `app.quit()` when lock fails. Throwing an error at module level could cause unhandled rejection. Simply not calling `app.whenReady()` is sufficient. |
| 2 | Previous plan didn't account for userData path affecting single-instance lock | ACCEPT | The userData path must be set BEFORE `setupDeepLinks()` because different flavors need different locks. This is critical for proper isolation. |
| 3 | Previous plan didn't show exact code changes with line numbers | ACCEPT | Will provide more specific code changes with exact line numbers. |

---

# Implementation Plan for Register Electron Deep-Link Handler Before App Ready

## 1. Feature Analysis

**What needs to be fixed and why:**

The current implementation registers the deep-link handler **after** `app.whenReady()` is called, which is incorrect. According to Electron documentation, `app.setAsDefaultProtocolClient()` and `app.requestSingleInstanceLock()` should be called **before** the app is ready for proper deep link handling on Windows and Linux.

**Current problematic flow in `main.ts`:**
```
Line 252: app.whenReady().then(initializeApp)
           └── initializeApp() (line 105)
               ├── Set userData path (lines 108-111)
               └── setupDeepLinks() (line 114) <-- TOO LATE!
```

**Required flow:**
```
Set userData path (at module level)
setupDeepLinks() (at module level, BEFORE app.whenReady())
if (gotTheLock) {
  app.whenReady().then(initializeApp)
}
```

**Critical insight from code comment (lines 106-107):**
> "Isolate userData per flavor so each has its own single-instance lock"

The userData path MUST be set BEFORE calling `setupDeepLinks()` because `app.requestSingleInstanceLock()` uses the userData directory to determine the lock. Different flavors need different locks.

**Technical complexity:** Low - This is a straightforward refactoring that moves existing code to an earlier point in the initialization sequence.

## 2. Files to Create/Modify

### Modified Files:
1. **`electron/src/app/main.ts`** - Move userData path setup and `setupDeepLinks()` call to module level, before `app.whenReady()`

## 3. Implementation Steps

### Step 1: Move userData path setup to module level (after line 57)

Insert the following code after `registerProtocolScheme()` call and before the `isQuitting` variable:

```typescript
if (config.useBundledUI) {
  registerProtocolScheme();
}

// Set userData path BEFORE requesting single-instance lock
// This ensures each flavor has its own lock, session storage, and electron-store data
if (config.USER_DATA_SUFFIX) {
  const currentUserData = app.getPath('userData');
  app.setPath('userData', `${currentUserData}${config.USER_DATA_SUFFIX}`);
}

// Register deep links BEFORE app is ready (required for Windows/Linux)
// This must be called before app.whenReady() for proper protocol handling
const gotTheLock = setupDeepLinks(createMainWindow);

// Track if app is quitting (for Cmd+Q support on macOS)
let isQuitting = false;
```

### Step 2: Remove userData path setup and `setupDeepLinks()` call from `initializeApp()` (lines 106-117)

Remove these lines from `initializeApp()`:
```typescript
// Isolate userData per flavor so each has its own single-instance lock,
// session storage, and electron-store data. Prod keeps the original path
if (config.USER_DATA_SUFFIX) {
  const currentUserData = app.getPath('userData');
  app.setPath('userData', `${currentUserData}${config.USER_DATA_SUFFIX}`);
}

// Register deep links BEFORE app is ready
const gotTheLock = setupDeepLinks(createMainWindow);
if (!gotTheLock) {
  app.quit();
}
```

The `initializeApp()` function should now start directly with the `setupCustomProtocol()` call (line 119-122).

### Step 3: Guard the `app.whenReady()` call (modify line 252)

Change:
```typescript
void app.whenReady().then(initializeApp);
```

To:
```typescript
// Only initialize if we have the single-instance lock
// setupDeepLinks() already calls app.quit() if lock fails
if (gotTheLock) {
  void app.whenReady().then(initializeApp);
}
```

## 4. Technical Details

### Key Considerations:

1. **Order of operations in `main.ts`:**
   - `setupGlobalErrorHandlers()` - First, to catch any initialization errors
   - `registerProtocolScheme()` - Before app ready (for bundled UI)
   - **Set userData path** - Before `setupDeepLinks()` (for flavor isolation)
   - **`setupDeepLinks()`** - Before app ready (this fix)
   - `app.whenReady().then(initializeApp)` - After all pre-ready setup

2. **Why userData path must come first:**
   - `app.requestSingleInstanceLock()` uses the userData directory to determine the lock
   - Different flavors (dev, staging, prod) need different locks
   - Without this, multiple flavors could conflict with each other

3. **The `setupDeepLinks` function already handles:**
   - `app.setAsDefaultProtocolClient()` - Protocol registration
   - `app.requestSingleInstanceLock()` - Single instance enforcement
   - `app.quit()` - Called internally when lock not acquired (line 39 in deep-links.ts)
   - `app.on('open-url')` - macOS deep link handling
   - `app.on('second-instance')` - Second instance handling
   - Windows startup deep link handling

4. **No changes needed to `deep-links.ts`:**
   - The function already uses `app.whenReady()` inside `handleDeepLink()` to ensure app is ready before processing deep links
   - The function signature and return value are appropriate for early registration

### Code Pattern to Follow:

The pattern already exists in the codebase for `registerProtocolScheme()`:
```typescript
if (config.useBundledUI) {
  registerProtocolScheme();
}
```

This is called at module level before `app.whenReady()`. The same pattern applies to `setupDeepLinks()`.

---

## Quality Gates Section

### 1. Code Reuse
- Reusing existing `setupDeepLinks()` function from `electron/src/services/deep-links.ts` - no new code needed
- The function already has all necessary logic for deep link handling including `app.quit()` when lock fails
- Reusing existing userData path setup logic - just moving it to module level

### 2. Architecture & Coding Style
- Following existing pattern of registering protocols before app ready (same as `registerProtocolScheme()`)
- Maintaining the existing module-level initialization pattern in `main.ts`
- Using the existing `gotTheLock` return value pattern

### 3. Comments
- Moving existing comment about userData path isolation with the code
- Adding clarifying comment about why userData path must be set before `setupDeepLinks()`

### 4. Same Issue Elsewhere
N/A - Feature implementation (refactoring), not a bug fix

### 5a. Crash Risk
- Minimal risk - the change only moves existing code to an earlier execution point
- The `setupDeepLinks` function already handles the case where app isn't ready (uses `app.whenReady()` internally in `handleDeepLink`)
- Guard on `app.whenReady()` prevents initialization if lock fails (though `app.quit()` already handles this)

### 5b. Performance
- No performance impact - same code executed at different time
- May actually improve startup reliability for deep link scenarios

### 5c. Backward Compatible
- Fully backward compatible - no API changes
- No migration needed - this is an internal initialization order fix

### 6. Scale Design
- N/A - This is a startup initialization change, not a runtime scaling concern

### 7. Design Principles
- **KISS**: Simple fix - just moving code to correct location
- **YAGNI**: No new code added, just reorganizing existing code
- **SRP**: Each function still has single responsibility

### 8. New APIs/Components
- None - reusing existing `setupDeepLinks()` function

### 9. File Changes
0 new files, 1 modified file:
- modified: `electron/src/app/main.ts`

### 10. Existing Code/Folder Structure
- Following existing Electron main process structure
- Following existing pattern of pre-ready initialization (like `registerProtocolScheme()`)
- No structural changes, just code reorganization within `main.ts`

### 11. Succinctness
- Minimal change - moving ~12 lines of code from inside a function to module level
- Adding guard for `app.whenReady()` call
- No unnecessary additions or refactoring beyond what's needed to fix the issue