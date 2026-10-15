package net.juspay.xynespaces.downloads

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.IOException

data class SavedDownload(
  val displayName: String,
  val uri: Uri,
  val mimeType: String,
)

class DownloadsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun saveFileToDownloads(sourceUri: String, displayName: String, mimeType: String, promise: Promise) {
    Thread {
      try {
        promise.resolve(saveFileToDownloads(reactContext, sourceUri, displayName, mimeType).displayName)
      } catch (error: Exception) {
        promise.reject("DOWNLOAD_SAVE_ERROR", error.message, error)
      }
    }.start()
  }

  companion object {
    const val NAME = "LotusDownloads"
    private const val MAX_FILENAME_ATTEMPTS = 100

    fun saveFileToDownloads(
      context: Context,
      sourceUri: String,
      displayName: String,
      mimeType: String,
    ): SavedDownload {
      val sourceFile = File(sourceUri.removePrefix("file://"))
      if (!sourceFile.isFile) {
        throw IOException("Source file does not exist.")
      }

      val safeName = sanitizeDisplayName(displayName)
      val safeMime = mimeType.ifBlank { "application/octet-stream" }
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveWithMediaStore(context, sourceFile, safeName, safeMime)
      } else {
        saveLegacy(context, sourceFile, safeName, safeMime)
      }
    }

    private fun saveWithMediaStore(
      context: Context,
      sourceFile: File,
      displayName: String,
      mimeType: String,
    ): SavedDownload {
      val resolver = context.contentResolver
      val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val uniqueName = resolveUniqueDisplayName(resolver, collection, displayName)

      val pendingValues = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, uniqueName)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }

      val itemUri =
        resolver.insert(collection, pendingValues)
          ?: throw IOException("Failed to create Downloads entry.")

      try {
        resolver.openOutputStream(itemUri)?.use { output ->
          FileInputStream(sourceFile).use { input ->
            input.copyTo(output)
          }
        } ?: throw IOException("Failed to open Downloads output stream.")

        resolver.update(
          itemUri,
          ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) },
          null,
          null,
        )
      } catch (error: Exception) {
        resolver.delete(itemUri, null, null)
        throw error
      }

      return SavedDownload(uniqueName, itemUri, mimeType)
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(
      context: Context,
      sourceFile: File,
      displayName: String,
      mimeType: String,
    ): SavedDownload {
      val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
        throw IOException("Failed to access Downloads directory.")
      }

      val uniqueName = resolveUniqueLegacyName(downloadsDir, displayName)
      val destination = File(downloadsDir, uniqueName)
      val downloadsRoot = downloadsDir.canonicalFile
      val destinationCanonical = destination.canonicalFile
      if (
        destinationCanonical != downloadsRoot &&
        !destinationCanonical.path.startsWith(downloadsRoot.path + File.separator)
      ) {
        throw IOException("Refusing to write outside Downloads.")
      }
      sourceFile.inputStream().use { input ->
        destination.outputStream().use { output ->
          input.copyTo(output)
        }
      }

      MediaScannerConnection.scanFile(context, arrayOf(destination.absolutePath), arrayOf(mimeType), null)
      return SavedDownload(uniqueName, Uri.fromFile(destination), mimeType)
    }

    private fun sanitizeDisplayName(displayName: String): String {
      val lastSegment = displayName
        .replace('\\', '/')
        .split('/')
        .lastOrNull { it.isNotBlank() && it != "." && it != ".." }
        ?: "attachment"
      val cleaned = buildString(lastSegment.length) {
        lastSegment.forEach { ch ->
          append(if (ch < ' ' || ch == '/' || ch == '\\') '_' else ch)
        }
      }.trim().trimStart('.')
      val limited = cleaned.take(180)
      return if (limited.isBlank() || limited == "." || limited == "..") "attachment" else limited
    }

    private fun resolveUniqueDisplayName(
      resolver: ContentResolver,
      collection: Uri,
      displayName: String,
    ): String = resolveUniqueName(displayName) { candidate ->
      displayNameExists(resolver, collection, candidate)
    }

    private fun resolveUniqueLegacyName(downloadsDir: File, displayName: String): String =
      resolveUniqueName(displayName) { candidate ->
        File(downloadsDir, candidate).exists()
      }

    private fun resolveUniqueName(displayName: String, exists: (String) -> Boolean): String {
      if (!exists(displayName)) {
        return displayName
      }

      val (base, ext) = splitFilename(displayName)
      for (attempt in 1 until MAX_FILENAME_ATTEMPTS) {
        val candidate = "$base ($attempt)$ext"
        if (!exists(candidate)) {
          return candidate
        }
      }

      throw IOException("Failed to find an available filename in Downloads.")
    }

    private fun displayNameExists(
      resolver: ContentResolver,
      collection: Uri,
      displayName: String,
    ): Boolean {
      resolver.query(
        collection,
        arrayOf(MediaStore.Downloads._ID),
        "${MediaStore.Downloads.DISPLAY_NAME} = ?",
        arrayOf(displayName),
        null,
      ).use { cursor ->
        return cursor?.moveToFirst() == true
      }
    }

    private fun splitFilename(filename: String): Pair<String, String> {
      val lastDot = filename.lastIndexOf('.')
      if (lastDot <= 0) {
        return filename to ""
      }
      return filename.substring(0, lastDot) to filename.substring(lastDot)
    }
  }
}
