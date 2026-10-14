package net.juspay.xynespaces.sharetarget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns.DISPLAY_NAME
import android.provider.OpenableColumns.SIZE
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private class TooManySharedFilesException : Exception(
  "Select up to 10 files to share at a time.",
)

class ShareTargetModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), ActivityEventListener {

  companion object {
    private val SHARE_ID_PATTERN = Regex(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    )

    // Match the composer upload cap in composer-attachments-picker.ts.
    private const val MAX_SHARE_FILE_BYTES = 1024L * 1024L * 1024L
    // Match the existing mailbox attachment count cap.
    private const val MAX_SHARE_FILE_COUNT = 10
    private const val COPY_BUFFER_BYTES = 64 * 1024
  }

  private data class CachedSharedFile(
    val uri: String,
    val originalUri: String,
    val name: String,
    val type: String,
    val size: Double,
  )

  private data class CachedSharePayload(
    val id: String,
    val receivedAt: Double,
    val subject: String?,
    val text: String?,
    val files: List<CachedSharedFile>,
    val signature: String?,
  )

  private val lock = Any()
  private val copyExecutor = Executors.newSingleThreadExecutor()
  private val copyExecutorShutdown = AtomicBoolean(false)
  private val copyGeneration = AtomicInteger(0)
  private var pendingPayload: CachedSharePayload? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName(): String = "LotusShareTargetModule"

  override fun invalidate() {
    shutdownShareCopyWork()
    super.invalidate()
  }

  @Deprecated("Use invalidate()")
  override fun onCatalystInstanceDestroy() {
    shutdownShareCopyWork()
    super.onCatalystInstanceDestroy()
  }

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  @ReactMethod
  fun getInitialShare(shareId: String?, promise: Promise) {
    try {
      if (shareId != null && !isValidShareId(shareId)) {
        promise.resolve(null)
        return
      }

      synchronized(lock) {
        val pending = pendingPayload
        if (pending != null && (shareId == null || pending.id == shareId)) {
          promise.resolve(toWritableMap(pending))
          return
        }
      }

      // An explicit deep-link ID must resolve only the matching pending share.
      // Do not reinterpret it as a new activity payload, which could expose a
      // different shared item to a stale or forged link.
      if (shareId != null) {
        promise.resolve(null)
        return
      }

      val intent = getCurrentActivity()?.intent
      val generation = copyGeneration.get()
      enqueueCopy {
        try {
          if (isCopyGenerationStale(generation)) {
            promise.resolve(null)
            return@enqueueCopy
          }
          val payload = parseIntent(intent, generation)
          if (payload == null) {
            promise.resolve(null)
            return@enqueueCopy
          }
          if (!publishPayload(generation, payload)) {
            clearShareFiles(payload.id)
            promise.resolve(null)
            return@enqueueCopy
          }
          promise.resolve(toWritableMap(payload))
      } catch (e: TooManySharedFilesException) {
        clearActivityShareIntentOnUi(signature(intent), generation)
        promise.reject("SHARE_TOO_MANY_FILES", e.message, e)
      } catch (e: Exception) {
        promise.reject("SHARE_READ_FAILED", e.message, e)
      }
      }
    } catch (e: Exception) {
      promise.reject("SHARE_READ_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun clearShare(shareId: String?, promise: Promise) {
    if (shareId != null && !isValidShareId(shareId)) {
      promise.resolve(false)
      return
    }

    if (shareId == null) {
      invalidateCopyGeneration()
    }

    val pending: CachedSharePayload?
    val shouldClearPending: Boolean
    synchronized(lock) {
      pending = pendingPayload
      shouldClearPending = pending != null && (shareId == null || pending.id == shareId)
      if (shouldClearPending) {
        pendingPayload = null
      }
    }
    val clearedSignature = if (shouldClearPending) pending?.signature else null
    val idToDelete = shareId ?: pending?.id
    if (idToDelete != null) {
      clearShareFiles(idToDelete)
    } else if (shareId == null) {
      clearShareFiles()
    }

    if (shouldClearPending || shareId == null) {
      clearActivityShareIntent(clearedSignature)
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun clearAllPendingShares(promise: Promise) {
    invalidateCopyGeneration()
    synchronized(lock) { pendingPayload = null }
    clearShareFiles()
    clearActivityShareIntent(null)
    promise.resolve(true)
  }

  override fun onNewIntent(intent: Intent) {
    try {
      val generation = copyGeneration.get()
      enqueueCopy {
        try {
          if (isCopyGenerationStale(generation)) return@enqueueCopy
          val payload = parseIntent(intent, generation) ?: return@enqueueCopy
          if (!publishPayload(generation, payload)) {
            clearShareFiles(payload.id)
            return@enqueueCopy
          }
          ctx.runOnJSQueueThread {
            if (isCopyGenerationStale(generation)) return@runOnJSQueueThread
            try {
              ctx
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("LotusShareTargetReceived", toWritableMap(payload))
            } catch (_: Exception) {
            }
          }
        } catch (e: TooManySharedFilesException) {
          if (isCopyGenerationStale(generation)) return@enqueueCopy
          clearActivityShareIntentOnUi(signature(intent), generation)
          emitShareError(
            "SHARE_TOO_MANY_FILES",
            e.message ?: "Select up to 10 files to share at a time.",
            generation,
          )
        } catch (_: Exception) {
          // Provider or copy failures must not escape the Activity intent path.
        }
      }
    } catch (_: Exception) {
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {}

  private fun parseIntent(intent: Intent?, generation: Int): CachedSharePayload? {
    if (intent == null) return null
    val action = intent.action ?: return null
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null

    val sig = signature(intent)
    val id = UUID.randomUUID().toString()
    val uris = streamUris(intent)
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val text = shareText(intent, subject)

    if (uris.size > MAX_SHARE_FILE_COUNT) {
      throw TooManySharedFilesException()
    }

    if (uris.isEmpty() && text.isNullOrBlank()) return null

    val files = mutableListOf<CachedSharedFile>()
    for (uri in uris) {
      if (isCopyGenerationStale(generation)) {
        clearShareFiles(id)
        return null
      }
      if (!isAllowedShareUri(uri)) continue
      runCatching { copyUriToCache(uri, id, intent.type, generation) }.getOrNull()?.let(files::add)
    }
    if (isCopyGenerationStale(generation)) {
      clearShareFiles(id)
      return null
    }
    if (files.isEmpty() && text.isNullOrBlank()) return null

    return CachedSharePayload(
      id = id,
      receivedAt = System.currentTimeMillis().toDouble(),
      subject = subject,
      text = text,
      files = files,
      signature = sig,
    )
  }

  private fun emitShareError(code: String, message: String, generation: Int) {
    ctx.runOnJSQueueThread {
      if (isCopyGenerationStale(generation)) return@runOnJSQueueThread
      try {
        ctx
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("LotusShareTargetError", Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
          })
      } catch (_: Exception) {
      }
    }
  }

  private fun toWritableMap(payload: CachedSharePayload): WritableMap {
    val files = Arguments.createArray()
    payload.files.forEach { file ->
      files.pushMap(Arguments.createMap().apply {
        putString("uri", file.uri)
        putString("originalUri", file.originalUri)
        putString("name", file.name)
        putString("type", file.type)
        putDouble("size", file.size)
      })
    }

    return Arguments.createMap().apply {
      putString("id", payload.id)
      putString("source", "android")
      putDouble("receivedAt", payload.receivedAt)
      putString("subject", payload.subject)
      putString("text", payload.text)
      putArray("files", files)
    }
  }

  private fun clearActivityShareIntent(expectedSignature: String?) {
    val activity = getCurrentActivity() ?: return
    val currentIntent = activity.intent ?: return
    val action = currentIntent.action ?: return
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return

    if (expectedSignature != null && signature(currentIntent) != expectedSignature) return

    activity.intent = Intent(Intent.ACTION_MAIN)
  }

  private fun clearActivityShareIntentOnUi(expectedSignature: String?, generation: Int) {
    ctx.runOnUiQueueThread {
      if (isCopyGenerationStale(generation)) return@runOnUiQueueThread
      clearActivityShareIntent(expectedSignature)
    }
  }

  private fun streamUris(intent: Intent): List<Uri> {
    val extra = intent.extras?.get(Intent.EXTRA_STREAM) ?: return emptyList()
    val uris = mutableListOf<Uri>()

    if (extra is ArrayList<*>) {
      extra.forEach { value -> value.toUriOrNull()?.let(uris::add) }
    } else {
      extra.toUriOrNull()?.let(uris::add)
    }

    return uris
  }

  private fun Any?.toUriOrNull(): Uri? {
    if (this is Uri) return this
    val value = this?.toString()?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { Uri.parse(value) }.getOrNull()
  }

  private fun shareText(intent: Intent, subject: String?): String? {
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
      ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()

    return when {
      !text.isNullOrBlank() &&
        (text.startsWith("http://") || text.startsWith("https://")) &&
        !subject.isNullOrBlank() -> "$subject\n$text"
      !text.isNullOrBlank() -> text
      !subject.isNullOrBlank() -> subject
      else -> null
    }
  }

  /**
   * Security (bug bounty #42): the sharing app chooses EXTRA_STREAM, but the copy runs
   * with OUR permissions. A `file://` URI (e.g. our own shared_prefs / databases holding
   * the session token) or a `content://` URI served by one of our own providers would let
   * any installed app make us copy private files into a message draft and upload them.
   * Accept only `content://` URIs owned by another app that do not point into our sandbox.
   */
  private fun isAllowedShareUri(uri: Uri): Boolean {
    if (!"content".equals(uri.scheme, ignoreCase = true)) return false
    return !isAppPrivateSource(uri)
  }

  private fun isAppPrivateSource(uri: Uri): Boolean {
    val authority = uri.authority ?: return true
    val ownPackage = ctx.packageName
    if (authority == ownPackage || authority.startsWith("$ownPackage.")) return true
    val provider = runCatching {
      ctx.packageManager.resolveContentProvider(authority, 0)
    }.getOrNull()
    if (provider != null && provider.packageName == ownPackage) return true

    val path = uri.path ?: return false
    val canonical = runCatching { File(path).canonicalPath }.getOrNull() ?: path
    val privateRoots = listOfNotNull(
      ctx.cacheDir,
      ctx.filesDir,
      ctx.noBackupFilesDir,
      ctx.codeCacheDir,
      ctx.dataDir,
    ).mapNotNull { root -> runCatching { root.canonicalPath }.getOrNull() }

    return privateRoots.any { root -> canonical == root || canonical.startsWith("$root/") }
  }

  private fun copyUriToCache(
    uri: Uri,
    shareId: String,
    fallbackMime: String?,
    generation: Int,
  ): CachedSharedFile? {
    if (!isAllowedShareUri(uri) || isCopyGenerationStale(generation)) return null

    val resolver = ctx.contentResolver
    val declaredSize = querySize(uri)
    if (declaredSize != null && declaredSize > MAX_SHARE_FILE_BYTES) return null

    val mime = resolver.getType(uri)
      ?: fallbackMime?.takeIf { it.isNotBlank() && it != "*/*" && !it.endsWith("/*") }
      ?: "application/octet-stream"
    val name = queryName(uri) ?: "shared-file.${extensionFor(mime)}"
    val dir = File(ctx.cacheDir, "share-target/$shareId").apply { mkdirs() }
    val target = uniqueTargetFile(dir, sanitize(name))

    try {
      resolver.openInputStream(uri)?.use { input ->
        FileOutputStream(target).use { output ->
          val buffer = ByteArray(COPY_BUFFER_BYTES)
          var total = 0L
          while (true) {
            if (isCopyGenerationStale(generation)) {
              throw IOException("share copy invalidated")
            }
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_SHARE_FILE_BYTES) {
              throw IOException("shared file exceeds upload size limit")
            }
            output.write(buffer, 0, read)
          }
        }
      } ?: return null
    } catch (_: Exception) {
      if (target.exists()) target.delete()
      if (dir.exists() && dir.list().isNullOrEmpty()) dir.delete()
      return null
    }

    if (isCopyGenerationStale(generation)) {
      if (target.exists()) target.delete()
      if (dir.exists()) dir.deleteRecursively()
      return null
    }

    return CachedSharedFile(
      uri = "file://${target.absolutePath}",
      originalUri = uri.toString(),
      name = name,
      type = mime,
      size = target.length().toDouble(),
    )
  }

  private fun isValidShareId(value: String): Boolean = SHARE_ID_PATTERN.matches(value)

  private fun clearShareFiles(shareId: String? = null) {
    if (shareId != null && !isValidShareId(shareId)) return
    val root = File(ctx.cacheDir, "share-target")
    val target = if (shareId == null) root else File(root, shareId)
    if (target.exists()) target.deleteRecursively()
  }

  private fun queryName(uri: Uri): String? {
    return runCatching {
      ctx.contentResolver.query(uri, arrayOf(DISPLAY_NAME, SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(DISPLAY_NAME)) else null
      }
    }.getOrNull()
  }

  private fun querySize(uri: Uri): Long? {
    return runCatching {
      ctx.contentResolver.query(uri, arrayOf(SIZE), null, null, null)?.use { c ->
        if (!c.moveToFirst()) return@use null
        val index = c.getColumnIndex(SIZE)
        if (index < 0 || c.isNull(index)) null else c.getLong(index)
      }
    }.getOrNull()
  }

  private fun extensionFor(mime: String): String =
    MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "bin"

  private fun sanitize(name: String): String =
    name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(180)

  private fun uniqueTargetFile(dir: File, name: String): File {
    var target = File(dir, name)
    if (!target.exists()) return target

    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var index = 1

    while (target.exists()) {
      target = File(dir, "${base}_$index$ext")
      index += 1
    }

    return target
  }

  private fun signature(intent: Intent?): String? {
    if (intent == null) return null
    val action = intent.action ?: ""
    val type = intent.type ?: ""
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: ""
    val streams = streamUris(intent).joinToString("|") { it.toString() }
    return "$action|$type|$subject|$text|$streams"
  }

  private fun isCopyGenerationStale(generation: Int): Boolean =
    copyExecutorShutdown.get() || generation != copyGeneration.get()

  private fun invalidateCopyGeneration() {
    copyGeneration.incrementAndGet()
  }

  private fun publishPayload(generation: Int, payload: CachedSharePayload): Boolean {
    synchronized(lock) {
      if (isCopyGenerationStale(generation)) return false
      pendingPayload = payload
      return true
    }
  }

  private fun enqueueCopy(work: () -> Unit) {
    if (copyExecutorShutdown.get()) return
    try {
      copyExecutor.execute {
        if (copyExecutorShutdown.get()) return@execute
        work()
      }
    } catch (_: RejectedExecutionException) {
    }
  }

  private fun shutdownShareCopyWork() {
    if (!copyExecutorShutdown.compareAndSet(false, true)) {
      return
    }
    invalidateCopyGeneration()
    synchronized(lock) { pendingPayload = null }
    copyExecutor.shutdownNow()
    clearShareFiles()
    try {
      ctx.removeActivityEventListener(this)
    } catch (_: Exception) {
    }
  }
}
