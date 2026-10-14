package net.juspay.xynespaces.http

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import net.juspay.xynespaces.BuildConfig
import net.juspay.xynespaces.certificate.CertificateManager
import okhttp3.OkHttpClient
import javax.net.ssl.HttpsURLConnection

/**
 * Installs an OkHttpClient factory that uses mTLS (client certificate) for all
 * React Native network requests (HTTP fetch + WebSocket) when the device is enrolled.
 *
 * Must be called early in Application.onCreate(), before any network requests.
 */
object MtlsOkHttpFactory {
    private const val TAG = "MtlsOkHttpFactory"

    /**
     * Installs the mTLS OkHttpClient factory. Call from Application.onCreate()
     * before loadReactNative().
     */
    @JvmStatic
    fun install(context: Context) {
        if (!BuildConfig.MTLS_ENABLED) {
            Log.d(TAG, "mTLS disabled; using default OkHttpClient")
            return
        }

        OkHttpClientProvider.setOkHttpClientFactory {
            try {
                val mtlsClient = MtlsNetworkClient(context)
                val (socketFactory, trustManager) = mtlsClient.buildSslConfigWithTrustManager()
            OkHttpClientProvider.createClientBuilder(context)
                    .sslSocketFactory(socketFactory, trustManager)
                    .hostnameVerifier(HttpsURLConnection.getDefaultHostnameVerifier())
                    .build()
            } catch (e: Exception) {
                // A default client is required only before enrollment, when no
                // client identity exists and the app must reach enrollment APIs.
                // Once a Keystore key exists, silently falling back would allow
                // authenticated traffic to bypass the mTLS client-certificate
                // policy after a partial or corrupted enrollment.
                val hasClientIdentity = CertificateManager.initialize(context).hasPrivateKey()
                if (hasClientIdentity) {
                    Log.e(TAG, "mTLS setup failed with a client identity present", e)
                    throw e
                }

                Log.w(TAG, "mTLS unavailable before enrollment; using default OkHttpClient")
                OkHttpClientProvider.createClientBuilder(context).build()
            }
        }
        Log.d(TAG, "MtlsOkHttpFactory installed")
    }
}
