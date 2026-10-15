package net.juspay.xynespaces.webview

import android.util.Log
import android.webkit.ClientCertRequest
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.reactnativecommunity.webview.RNCWebChromeClient
import com.reactnativecommunity.webview.RNCWebViewClient
import net.juspay.xynespaces.BuildConfig
import net.juspay.xynespaces.http.MtlsTransportPolicy
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.X509Certificate

@ReactModule(name = MtlsWebViewModule.NAME)
class MtlsWebViewModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "MtlsWebViewModule"
        private const val TAG = "MtlsWebViewModule"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "ClientIdentity"

        @Volatile
        internal var clientCertificate: X509Certificate? = null

        @Volatile
        internal var clientCertificateChain: Array<X509Certificate>? = null

        @Volatile
        internal var privateKey: PrivateKey? = null

        @Volatile
        internal var isConfigured = false

        init {
            // Media capture is independent of mTLS enrollment. Keep the
            // permission boundary active for dev/non-mTLS builds as well.
            RNCWebChromeClient.setAllowedMediaCaptureOrigins(
                setOf(BuildConfig.DASHBOARD_ORIGIN),
            )
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun enableMtls(promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

            if (!keyStore.containsAlias(KEY_ALIAS)) {
                val error = "Certificate not found. Please complete enrollment first."
                Log.e(TAG, error)
                promise.reject("NO_CERTIFICATE", error)
                return
            }

            val keyEntry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            if (keyEntry == null) {
                val error = "Failed to retrieve key entry"
                Log.e(TAG, error)
                promise.reject("KEY_ERROR", error)
                return
            }

            if (keyEntry.certificateChain.isNullOrEmpty()) {
                val error = "Certificate chain not found. Please re-enroll."
                Log.e(TAG, error)
                promise.reject("NO_CERT_CHAIN", error)
                return
            }

            val certChain = keyEntry.certificateChain
                .filterIsInstance<X509Certificate>()
                .toTypedArray()
            if (certChain.isEmpty()) {
                val error = "Certificate chain was empty after parsing. Please re-enroll."
                Log.e(TAG, error)
                promise.reject("EMPTY_CERT_CHAIN", error)
                return
            }

            clientCertificate = certChain.first()
            clientCertificateChain = certChain
            privateKey = keyEntry.privateKey
            isConfigured = true
            RNCWebViewClient.setAllowedClientCertificateOrigins(
                setOf(BuildConfig.API_ORIGIN, BuildConfig.DASHBOARD_ORIGIN),
            )

            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to enable mTLS", e)
            promise.reject("MTLS_ENABLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun disableMtls(promise: Promise) {
        try {
            clientCertificate = null
            clientCertificateChain = null
            privateKey = null
            isConfigured = false
            RNCWebViewClient.setAllowedClientCertificateOrigins(emptySet())
            RNCWebChromeClient.setAllowedMediaCaptureOrigins(
                setOf(BuildConfig.DASHBOARD_ORIGIN),
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("MTLS_DISABLE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isMtlsEnabled(promise: Promise) {
        promise.resolve(isConfigured)
    }
}

object MtlsWebViewHelper {
    private const val TAG = "MtlsWebViewHelper"

    @JvmStatic
    fun isMtlsEnabled(): Boolean {
        return MtlsWebViewModule.isConfigured
    }

    @JvmStatic
    fun getPrivateKey(): PrivateKey? {
        return MtlsWebViewModule.privateKey
    }

    @JvmStatic
    fun getCertificate(): X509Certificate? {
        return MtlsWebViewModule.clientCertificate
    }

    @JvmStatic
    fun getCertificateChain(): Array<X509Certificate>? {
        return MtlsWebViewModule.clientCertificateChain
    }

    @JvmStatic
    fun handleClientCertRequest(request: ClientCertRequest) {
        if (!MtlsTransportPolicy.isApprovedWebViewClientCertificateRequest(request.host, request.port)) {
            Log.w(TAG, "Rejected client certificate request for unapproved destination")
            request.cancel()
            return
        }

        val key = getPrivateKey()
        val cert = getCertificate()

        if (!isMtlsEnabled() || key == null || cert == null) {
            Log.w(TAG, "mTLS not configured, canceling request")
            request.cancel()
            return
        }

        try {
            Log.d(TAG, "Providing client certificate to approved destination")
            request.proceed(key, getCertificateChain() ?: arrayOf(cert))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to provide certificate", e)
            request.cancel()
        }
    }
}
