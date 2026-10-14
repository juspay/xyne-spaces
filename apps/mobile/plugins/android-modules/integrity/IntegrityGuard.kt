package net.juspay.xynespaces.integrity

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Debug
import android.util.Log
import java.security.MessageDigest
import net.juspay.xynespaces.BuildConfig

/**
 * Runtime code-integrity checks (PY-JP-013, OWASP "Insufficient Binary Protections").
 *
 * Implements the three remediation bullets from §3.13 of the Payatu MAPT report:
 *  1. Verify the application's signing certificate at runtime.
 *  2. Anti-debugging / anti-tampering.
 *  3. Verify the origin of the installation.
 *
 * Enforcement is gated on [BuildConfig.INTEGRITY_ENFORCED] so dev/sandbox builds — which are
 * signed with the (publicly committed) debug keystore and installed over adb — are unaffected.
 * That field also doubles as the kill switch if a bad certificate pin ever ships.
 *
 * Note: the APK signature covers `assets/index.android.bundle`, so [verifySigningCertificate]
 * also detects a swapped React Native bundle — no separate bundle hash is required.
 */
object IntegrityGuard {
    private const val TAG = "IntegrityGuard"

    enum class Failure {
        SIGNATURE,
        DEBUGGABLE,
        INSTALL_SOURCE,
    }

    @Volatile
    private var cachedResult: Failure? = null

    @Volatile
    private var hasRun = false

    /** Non-null when the last [check] failed. Exposed to JS through IntegrityModule. */
    val lastFailure: Failure?
        get() = cachedResult

    val isEnforced: Boolean
        get() = BuildConfig.INTEGRITY_ENFORCED

    /**
     * Runs every check. Result is memoised — the guard is invoked from both
     * MainApplication.onCreate and MainActivity.onCreate, and neither result can change
     * within a process lifetime.
     */
    @Synchronized
    fun check(context: Context): Boolean {
        if (hasRun) return cachedResult == null

        val failure = firstFailure(context)
        cachedResult = failure
        hasRun = true

        if (failure != null) {
            Log.e(TAG, "Integrity check failed: $failure")
            reportNonFatal(failure)
        }
        return failure == null
    }

    /**
     * Shows [TamperBlockActivity] and finishes [activity].
     *
     * Call ONLY after the caller has satisfied the Activity contract by invoking
     * `super.onCreate(...)`. Returning from `onCreate` without calling super raises
     * `android.util.SuperNotCalledException`, which crashes the process — the user then sees
     * "app keeps stopping" instead of the block screen, and the block screen dies with the
     * process it shares.
     *
     * Uses plain [Activity.finish] rather than `finishAffinity()`: the block screen declares
     * its own `taskAffinity`, but `finishAffinity()` would still tear down anything sharing
     * this task and race the screen we just launched.
     */
    fun block(activity: Activity) {
        if (!BuildConfig.INTEGRITY_ENFORCED) return

        val intent = Intent(activity, TamperBlockActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        activity.finish()
    }

    private fun firstFailure(context: Context): Failure? {
        if (!BuildConfig.INTEGRITY_ENFORCED) return null
        if (!verifySigningCertificate(context)) return Failure.SIGNATURE
        if (!verifyNotDebuggable(context)) return Failure.DEBUGGABLE
        if (!verifyInstallSource(context)) return Failure.INSTALL_SOURCE
        return null
    }

    // --- Bullet 1: signing certificate -------------------------------------------------------

    private fun verifySigningCertificate(context: Context): Boolean {
        val expected = parseAllowlist(BuildConfig.INTEGRITY_SIGNING_SHA256)
        if (expected.isEmpty()) {
            // Fail closed: an empty pin with enforcement on is a build misconfiguration, and
            // treating it as "allow" would silently disable the control. The config plugin
            // fails the prebuild for this case; this is the second line of defence.
            Log.e(TAG, "No signing certificate pinned while enforcement is enabled")
            return false
        }

        val actual = signingCertificateDigests(context)
        if (actual.isEmpty()) return false

        // Every signer must be pinned — not just one of them — so an attacker cannot append
        // their own certificate to a multi-signer APK and pass.
        return actual.all { digest -> expected.any { constantTimeEquals(it, digest) } }
    }

    private fun signingCertificateDigests(context: Context): List<ByteArray> {
        val pm = context.packageManager
        val pkg = context.packageName
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
                val signingInfo = info.signingInfo ?: return emptyList()
                // Always apkContentsSigners: it reports the certificates the APK is signed with
                // *now*, for both the single- and multiple-signer cases. Deliberately not
                // signingCertificateHistory — that also returns superseded certificates from a
                // key rotation, and requiring all of them to be pinned would break the moment
                // Play rotates the app signing key.
                signingInfo.apkContentsSigners?.map { sha256(it.toByteArray()) } ?: emptyList()
            } else {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                info.signatures?.map { sha256(it.toByteArray()) } ?: emptyList()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Unable to read signing certificates", e)
            emptyList()
        }
    }

    // --- Bullet 2: anti-debugging / anti-tampering --------------------------------------------

    private fun verifyNotDebuggable(context: Context): Boolean {
        // A release build is never debuggable. apktool repacks commonly flip this on, so this
        // catches the repackaging workflow even before the signature check would.
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) {
            Log.e(TAG, "Application is flagged debuggable")
            return false
        }
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) {
            Log.e(TAG, "Debugger attached")
            return false
        }
        return true
    }

    // --- Bullet 3: install origin --------------------------------------------------------------

    private fun verifyInstallSource(context: Context): Boolean {
        val allowed = BuildConfig.INTEGRITY_ALLOWED_INSTALLERS
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        if (allowed.isEmpty()) return true

        val installer = installingPackageName(context)
        if (installer == null) {
            // Sideloaded (`adb install`, file manager, unknown source).
            Log.e(TAG, "No installing package recorded")
            return false
        }
        if (installer !in allowed) {
            Log.e(TAG, "Untrusted install source: $installer")
            return false
        }
        return true
    }

    private fun installingPackageName(context: Context): String? {
        val pm = context.packageManager
        val pkg = context.packageName
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(pkg).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(pkg)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Unable to read install source", e)
            null
        }
    }

    // --- helpers -------------------------------------------------------------------------------

    /** Accepts `AA:BB:...` or `AABB...`, comma-separated, case-insensitive. */
    private fun parseAllowlist(raw: String): List<ByteArray> {
        return raw.split(',')
            .map { it.trim().replace(":", "").replace(" ", "").uppercase() }
            .filter { it.length == 64 && it.all { c -> c in '0'..'9' || c in 'A'..'F' } }
            .mapNotNull { hexToBytes(it) }
    }

    private fun hexToBytes(hex: String): ByteArray? {
        return try {
            ByteArray(hex.length / 2) { i ->
                ((Character.digit(hex[i * 2], 16) shl 4) or Character.digit(hex[i * 2 + 1], 16))
                    .toByte()
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    private fun reportNonFatal(failure: Failure) {
        // Best-effort: the guard runs before Firebase is guaranteed to be initialised, and a
        // telemetry failure must never mask the integrity failure itself.
        try {
            com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance()
                .recordException(IntegrityViolation(failure))
        } catch (e: Throwable) {
            Log.w(TAG, "Could not record integrity violation", e)
        }
    }

    class IntegrityViolation(failure: Failure) :
        RuntimeException("Integrity check failed: $failure")
}
