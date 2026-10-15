package net.juspay.xynespaces

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.util.Log
import `in`.juspay.airborneplugin.Airborne
import `in`.juspay.airborneplugin.AirborneInterface
import org.json.JSONObject
import com.facebook.react.ReactHost

class AirborneManager private constructor() {

    companion object {
        private const val TAG = "AirborneManager"
        private const val RELEASE_URL =
            "https://airborne.juspay.in/release/xyne/xyne-mobile-android"
        private const val NAMESPACE = "xyne-mobile-android"
        private const val CUG_URI = "juspay://pay/cug"
        private const val CUG_PACKAGE = "in.juspay.cug"
        private const val FORCE_CUG_PACKAGE = "in.juspay.cugext"

        @Volatile
        private var INSTANCE: AirborneManager? = null

        fun getInstance(): AirborneManager {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: AirborneManager().also { INSTANCE = it }
            }
        }
    }

    var airborne: Airborne? = null
        private set
    private var isInitialized = false

    @Volatile
    var otaUpdatePending = false
        private set

    var onEventListener: ((level: String, label: String, key: String, value: JSONObject, category: String, subCategory: String) -> Unit)? = null

    var reactHost: ReactHost? = null

    var hasFCMUpdateHappenedInBg: Boolean = false

    fun markOtaUpdatePending() {
        otaUpdatePending = true
        Log.d(TAG, "OTA update marked as pending")
    }

    fun isInitialized(): Boolean = isInitialized

    fun initialize(ctx: Context, appVersion: String, force: Boolean = false) {
        // Startup timing hooks (best-effort). Safe even if Airborne is disabled for testing.
        try {
            AppStartupTimes.airborneInitStartUptimeMs = SystemClock.uptimeMillis()
        } catch (_: Throwable) {
            // ignore if AppStartupTimes isn't present
        }

        if (isInitialized && !force) {
            Log.d(TAG, "Airborne already initialized, skipping")
            try {
                AppStartupTimes.airborneInitEndUptimeMs = SystemClock.uptimeMillis()
            } catch (_: Throwable) {
            }
            return
        }

        try {
            synchronized(this) {
                if (isInitialized && !force) return
                isInitialized = true
            }

            val instance = Airborne(ctx, RELEASE_URL, getAirborneInterface(ctx, appVersion))
            airborne = instance
            Log.i(TAG, "Airborne initialized successfully")
            try {
                AppStartupTimes.airborneInitEndUptimeMs = SystemClock.uptimeMillis()
            } catch (_: Throwable) {
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Airborne", e)
            try {
                AppStartupTimes.airborneInitEndUptimeMs = SystemClock.uptimeMillis()
            } catch (_: Throwable) {
            }
        }
    }

    private fun isAppInForeground(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        val appProcesses = am.runningAppProcesses ?: return false
        val packageName = ctx.packageName
        return appProcesses.any {
            it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                && it.processName == packageName
        }
    }

    private fun getAirborneInterface(ctx: Context, appVersion: String): AirborneInterface {
        return object : AirborneInterface() {
            override fun getNamespace(): String = NAMESPACE

            override fun getDimensions(): HashMap<String, String> {
                val map = HashMap<String, String>()
                map["app_version"] = appVersion
                map["is_cug"] = (isCug(ctx) || isForceCug(ctx)).toString()
                return map
            }

            override fun onEvent(
                level: String, label: String, key: String, value: JSONObject,
                category: String, subCategory: String
            ) {
                Log.d("AIRBORNE_EVENT", "level=$level label=$label key=$key category=$category subCategory=$subCategory")
                onEventListener?.invoke(level, label, key, value, category, subCategory)

                if (otaUpdatePending && key == "important_package_download_result") {
                    if (!isAppInForeground(ctx)) {
                        Log.d(TAG, "OTA download complete and app is backgrounded, force re-initializing in 2s")
                        otaUpdatePending = false
                        isInitialized = false
                        hasFCMUpdateHappenedInBg = true
                        Thread {
                            Thread.sleep(2000)
                            initialize(ctx, appVersion, force = true)
                            Log.d(TAG, "Airborne re-initialized, triggering bundle reload")
                        }.start()
                    } else {
                        Log.d(TAG, "OTA download complete but app is in foreground, deferring re-init")
                    }
                }
            }

            override fun startApp(indexPath: String) {
                Log.i(TAG, "Boot complete, bundle: $indexPath")
                AppStartupTimes.airborneStartAppUptimeMs = SystemClock.uptimeMillis()

                if(hasFCMUpdateHappenedInBg) {
                    Log.i(TAG, "FCM REFRESH, bundle: $indexPath")
                    reactHost?.reload("OTA bundle updated")
                }
            }
        }
    }

    private fun isCug(context: Context): Boolean =
        hasAppWithPackageForUri(context, CUG_URI, CUG_PACKAGE)

    private fun isForceCug(context: Context): Boolean =
        hasAppWithPackageForUri(context, CUG_URI, FORCE_CUG_PACKAGE)

    private fun hasAppWithPackageForUri(
        context: Context,
        uri: String,
        expectedPackageSubstring: String
    ): Boolean {
        return try {
            val pm = context.packageManager
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))

            val launchables = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }

            launchables.any {
                it.activityInfo?.packageName?.contains(expectedPackageSubstring) == true
            }
        } catch (_: Exception) {
            false
        }
    }
}
