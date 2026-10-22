package net.juspay.xynespaces.crashreporter

import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Native crash reporter module for Lotus (Android).
 *
 * Installs a [Thread.UncaughtExceptionHandler] that persists uncaught Java/Kotlin
 * exceptions to a file before chaining to the previous handler. On the next app
 * launch the JS layer calls [getPendingCrash] to recover and report the crash.
 *
 * Safety notes:
 * - Crash-time file I/O is wrapped in try/catch so a secondary failure does not mask
 *   the original crash.
 * - The previous handler is always chained so debuggers or other crash SDKs are not
 *   silently disabled.
 * - Corrupt JSON on read is treated as "no crash" and the file is deleted.
 */
class LotusCrashReporterModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "LotusCrashReporter"
    const val CRASH_FILE_NAME = "native_crash_pending.json"
  }

  private val crashFile: File = File(reactContext.filesDir, CRASH_FILE_NAME)

  init {
    val oldHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")

        val crashData = JSONObject().apply {
          put("type", "native_android")
          put("message", throwable.message ?: throwable.javaClass.simpleName)
          put("exceptionClass", throwable.javaClass.name)
          put("stack", Log.getStackTraceString(throwable))
          put("thread", thread.name)
          put("timestamp", sdf.format(Date()))
        }

        crashFile.writeText(crashData.toString())
      } catch (_: Exception) {
        // Ignore any failure during crash handling so the original crash
        // is not masked by a secondary I/O error.
      }

      // Chain to previous handler.
      oldHandler?.uncaughtException(thread, throwable)
    }
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun getPendingCrash(promise: Promise) {
    if (!crashFile.exists()) {
      promise.resolve(null)
      return
    }

    try {
      val content = crashFile.readText()
      val json = JSONObject(content)

      val map = WritableNativeMap().apply {
        putString("type", json.optString("type", "native_android"))
        putString("message", json.optString("message", ""))
        putString("exceptionClass", json.optString("exceptionClass", ""))
        putString("stack", json.optString("stack", ""))
        putString("thread", json.optString("thread", ""))
        putString("timestamp", json.optString("timestamp", ""))
      }
      promise.resolve(map)
    } catch (_: Exception) {
      // Corrupt file — delete and report no crash.
      crashFile.delete()
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun clearPendingCrash(promise: Promise) {
    val existed = crashFile.exists()
    if (existed) {
      crashFile.delete()
    }
    promise.resolve(existed)
  }

  @ReactMethod
  fun simulateNativeCrash() {
    Handler(Looper.getMainLooper()).post {
      throw RuntimeException("Simulated crash from LotusCrashReporter")
    }
  }

  @ReactMethod
  fun getNativeAppInfo(promise: Promise) {
    val context = reactApplicationContext
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)

    val versionCode = if (android.os.Build.VERSION.SDK_INT >=
      android.os.Build.VERSION_CODES.P
    ) {
      packageInfo.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      packageInfo.versionCode.toLong()
    }

    val isDebug = (context.applicationInfo.flags and
      ApplicationInfo.FLAG_DEBUGGABLE) != 0

    val map = WritableNativeMap().apply {
      putString("bundleIdentifier", context.packageName)
      putString("packageName", context.packageName)
      putString("version", packageInfo.versionName ?: "unknown")
      putDouble("versionCode", versionCode.toDouble())
      putString("buildType", if (isDebug) "debug" else "release")
      putBoolean("isDebug", isDebug)
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }
    promise.resolve(map)
  }
}
