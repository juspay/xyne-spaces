import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const androidSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/sharetarget/ShareTargetModule.kt'),
  'utf8',
);
const iosSource = readFileSync(
  resolve(process.cwd(), 'plugins/ios-modules/ShareTargetModule.swift'),
  'utf8',
);
const iosShareExtensionSource = readFileSync(
  resolve(process.cwd(), 'plugins/share-extension/ShareViewController.swift'),
  'utf8',
);
const bridgeSource = readFileSync(
  resolve(process.cwd(), 'src/features/share-target/nativeShareTarget.ts'),
  'utf8',
);
const deepLinkSource = readFileSync(
  resolve(process.cwd(), 'src/features/share-target/useIncomingShareTarget.ts'),
  'utf8',
);
const routeSource = readFileSync(
  resolve(process.cwd(), 'app/(protected)/share-target.tsx'),
  'utf8',
);
const authSource = readFileSync(resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');

describe('share-target security boundary', () => {
  it('validates share identifiers before native filesystem access', () => {
    assert.match(bridgeSource, /export function isValidShareId/);
    assert.match(deepLinkSource, /isValidShareId\(id\)/);
    assert.match(androidSource, /SHARE_ID_PATTERN/);
    assert.match(androidSource, /isValidShareId\(shareId\)/);
    assert.match(iosSource, /private func isValidShareId\(_ value: String\)/);
    assert.match(iosSource, /guard isValidShareId\(shareId\)/);
  });

  it('removes copied share files on completion and logout', () => {
    assert.match(androidSource, /clearShareFiles\(idToDelete\)/);
    assert.match(androidSource, /fun clearAllPendingShares/);
    assert.match(androidSource, /target\.deleteRecursively\(\)/);
    assert.match(iosSource, /clearShareFiles\(shareId\)/);
    assert.match(iosSource, /latestId == shareId/);
    assert.match(iosSource, /clearAllPendingShares/);
    assert.match(bridgeSource, /clearAllPendingShares\(\)/);
    assert.match(routeSource, /ShareTargetNative\.clearShare\(activePayload\.id\)/);
    assert.match(routeSource, /usePreventRemove\(isSending/);
    assert.match(routeSource, /isSendingRef\.current/);
    assert.match(routeSource, /gestureEnabled: !isSending/);
    assert.match(routeSource, /headerBackButtonMenuEnabled: false/);
    assert.match(routeSource, /pendingSendNavigation/);
    assert.match(authSource, /stage: 'clear_pending_share_artifacts'/);
    assert.match(authSource, /CLEAR_PENDING_SHARE_TIMEOUT_MS/);
  });

  it('accepts only content URIs and rejects app-private sources', () => {
    assert.match(
      androidSource,
      /if \(!"content"\.equals\(uri\.scheme, ignoreCase = true\)\) return false/,
    );
    assert.match(androidSource, /fun isAppPrivateSource\(uri: Uri\): Boolean/);
    // Our own providers, by authority name and by the package that actually serves them.
    assert.match(
      androidSource,
      /authority == ownPackage \|\| authority\.startsWith\("\$ownPackage\."\)/,
    );
    assert.match(androidSource, /resolveContentProvider\(authority, 0\)/);
    assert.match(androidSource, /provider\.packageName == ownPackage/);
    assert.match(androidSource, /ctx\.cacheDir/);
    assert.match(androidSource, /ctx\.filesDir/);
    assert.match(androidSource, /ctx\.noBackupFilesDir/);
    assert.match(androidSource, /ctx\.codeCacheDir/);
    assert.match(androidSource, /ctx\.dataDir/);
  });

  it('copies shared files off the UI thread and rejects over-limit selections', () => {
    assert.match(androidSource, /Executors\.newSingleThreadExecutor\(\)/);
    assert.match(androidSource, /copyExecutor\.execute/);
    assert.match(androidSource, /MAX_SHARE_FILE_BYTES = 1024L \* 1024L \* 1024L/);
    assert.match(androidSource, /MAX_SHARE_FILE_COUNT = 10/);
    assert.match(androidSource, /if \(uris\.size > MAX_SHARE_FILE_COUNT\)/);
    assert.match(androidSource, /SHARE_TOO_MANY_FILES/);
    assert.doesNotMatch(androidSource, /if \(files\.size >= MAX_SHARE_FILE_COUNT\) break/);
    assert.match(androidSource, /if \(isCopyGenerationStale\(generation\)\) return@enqueueCopy/);
    assert.match(
      androidSource,
      /if \(isCopyGenerationStale\(generation\)\) return@runOnJSQueueThread/,
    );
    assert.match(bridgeSource, /addErrorListener/);
    assert.match(deepLinkSource, /lastTooManyFilesAlertAtRef/);
    assert.match(routeSource, /SHARE_TOO_MANY_FILES/);
    assert.match(
      androidSource,
      /if \(declaredSize != null && declaredSize > MAX_SHARE_FILE_BYTES\) return null/,
    );
    assert.match(androidSource, /if \(total > MAX_SHARE_FILE_BYTES\)/);
    assert.match(
      iosShareExtensionSource,
      /private static let maxShareFileBytes: Int64 = 1024 \* 1024 \* 1024/,
    );
    assert.match(iosShareExtensionSource, /private static let maxShareFileCount = 10/);
    assert.match(iosShareExtensionSource, /var fileProviders: \[NSItemProvider\] = \[\]/);
    assert.match(
      iosShareExtensionSource,
      /guard fileProviders\.count <= Self\.maxShareFileCount else/,
    );
    assert.match(iosShareExtensionSource, /Select up to .*Self\.maxShareFileCount.*files/);
    assert.match(iosShareExtensionSource, /isErrorAcknowledgement/);
    assert.match(iosShareExtensionSource, /completeRequest\(returningItems: nil\)/);
    assert.doesNotMatch(
      iosShareExtensionSource,
      /fileProviderCount|files\.count >= Self\.maxShareFileCount/,
    );
    assert.match(
      iosShareExtensionSource,
      /private func copyBoundedFile\(from source: URL, to destination: URL\)/,
    );
    assert.match(iosShareExtensionSource, /totalBytes > Self\.maxShareFileBytes/);
    assert.match(iosShareExtensionSource, /let displayName = url\.lastPathComponent/);
    assert.match(
      iosShareExtensionSource,
      /let storageName = self\.sanitizeFileName\(displayName\)/,
    );
    assert.match(iosShareExtensionSource, /"name": displayName/);
  });

  it('rejects unsafe payloads before a share can be sent', () => {
    assert.match(routeSource, /getSharePayloadValidationError/);
    assert.match(routeSource, /assertAttachmentCountWithinLimit/);
    assert.match(routeSource, /getAttachmentRejectionReason/);
    assert.match(routeSource, /ShareTargetNative\.clearShare\(next\.id\)/);
  });

  it('deletes partial copies and swallows provider failures in onNewIntent', () => {
    assert.match(androidSource, /if \(target\.exists\(\)\) target\.delete\(\)/);
    assert.match(
      androidSource,
      /if \(dir\.exists\(\) && dir\.list\(\)\.isNullOrEmpty\(\)\) dir\.delete\(\)/,
    );
    assert.match(
      androidSource,
      /runCatching \{ copyUriToCache\(uri, id, intent\.type, generation\) \}\.getOrNull\(\)/,
    );
    assert.match(
      androidSource,
      /override fun onNewIntent\(intent: Intent\) \{[\s\S]*?catch \(_: Exception\) \{/s,
    );
    assert.match(
      iosShareExtensionSource,
      /if let destination \{[\s\S]*?removeItem\(at: destination\)/s,
    );
    assert.match(iosShareExtensionSource, /private func isAppPrivateSource\(_ url: URL\)/);
    assert.match(iosShareExtensionSource, /let extensionPart = nsName\.pathExtension/);
  });

  it('invalidates queued copies after logout and shuts the copier down with the module', () => {
    assert.match(androidSource, /copyGeneration/);
    assert.match(androidSource, /fun invalidateCopyGeneration\(\)/);
    assert.match(androidSource, /fun isCopyGenerationStale\(generation: Int\): Boolean/);
    assert.match(
      androidSource,
      /fun publishPayload\(generation: Int, payload: CachedSharePayload\): Boolean/,
    );
    assert.match(androidSource, /fun shutdownShareCopyWork\(\)/);
    assert.match(androidSource, /copyExecutor\.shutdownNow\(\)/);
    assert.match(androidSource, /override fun invalidate\(\)/);
    assert.match(androidSource, /fun clearAllPendingShares[\s\S]*invalidateCopyGeneration\(\)/s);
    assert.match(
      androidSource,
      /if \(isCopyGenerationStale\(generation\)\) return@runOnJSQueueThread/,
    );
  });
});
