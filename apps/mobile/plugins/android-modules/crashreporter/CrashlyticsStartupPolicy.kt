package net.juspay.xynespaces.crashreporter

import android.content.Context
import net.juspay.xynespaces.BuildConfig

/**
 * Applies the build's Crashlytics collection policy before Firebase content
 * providers are created. Both RNFB and the Firebase SDK persist collection
 * overrides, so the build default alone is not enough when an installation is
 * upgraded between logging-enabled and logging-disabled variants.
 */
object CrashlyticsStartupPolicy {
    private const val RNFB_PREFERENCES = "io.invertase.firebase"
    private const val RNFB_COLLECTION_KEY = "crashlytics_auto_collection_enabled"
    private const val FIREBASE_PREFERENCES = "com.google.firebase.crashlytics"
    private const val FIREBASE_COLLECTION_KEY = "firebase_crashlytics_collection_enabled"

    fun apply(context: Context) {
        context.getSharedPreferences(RNFB_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(RNFB_COLLECTION_KEY, BuildConfig.REMOTE_LOGGING_ENABLED)
            .commit()
        context.getSharedPreferences(FIREBASE_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(FIREBASE_COLLECTION_KEY, BuildConfig.REMOTE_LOGGING_ENABLED)
            .commit()
    }
}
