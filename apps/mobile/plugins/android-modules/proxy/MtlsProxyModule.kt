package net.juspay.xynespaces.proxy

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * React Native module for managing the local mTLS HTTP proxy server.
 * Allows JS to start/stop the proxy and get proxied URLs.
 */
@ReactModule(name = MtlsProxyModule.NAME)
class MtlsProxyModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "MtlsProxy"
        private const val TAG = "MtlsProxyModule"
        private const val DEFAULT_PORT = 18080

        @Volatile
        private var serverInstance: MtlsProxyServer? = null

        @Volatile
        private var authToken: String? = null

        @JvmStatic
        fun getServerInstance(): MtlsProxyServer? = serverInstance

        @JvmStatic
        fun getAuthToken(): String? = authToken
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun getProxySecurityVersion(promise: Promise) {
        promise.resolve(2)
    }

    /**
     * Start the proxy server on the specified port (or auto-assign if 0)
     */
    @ReactMethod
    fun start(port: Int, apiBaseUrl: String?, promise: Promise) {
        try {
            synchronized(this) {
                if (serverInstance != null) {
                    val existingPort = serverInstance?.getPort() ?: 0
                    Log.d(TAG, "Proxy already running on port $existingPort")
                    promise.resolve(existingPort)
                    return
                }

                val baseUrl = apiBaseUrl?.trim().orEmpty()
                if (baseUrl.isEmpty()) {
                    promise.reject("START_ERROR", "API base URL is required for proxy policy", null)
                    return
                }
                val server = MtlsProxyServer(
                    reactApplicationContext,
                    if (port > 0) port else DEFAULT_PORT,
                    baseUrl,
                )
                server.start()
                serverInstance = server

                val actualPort = server.getPort()
                Log.i(TAG, "Proxy started on port $actualPort")
                promise.resolve(actualPort)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start proxy", e)
            promise.reject("START_ERROR", e.message, e)
        }
    }

    /**
     * Stop the proxy server
     */
    @ReactMethod
    fun stop(promise: Promise) {
        try {
            synchronized(this) {
                serverInstance?.stop()
                serverInstance = null
                authToken = null
                Log.i(TAG, "Proxy stopped")
                promise.resolve(null)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop proxy", e)
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    /**
     * Get the current proxy port (0 if not running)
     */
    @ReactMethod
    fun getPort(promise: Promise) {
        val port = serverInstance?.getPort() ?: 0
        promise.resolve(port)
    }

    /**
     * Convert a backend URL to a proxied localhost URL
     */
    @ReactMethod
    fun getProxiedUrl(backendUrl: String, promise: Promise) {
        val server = serverInstance
        if (server == null) {
            promise.reject("NOT_RUNNING", "Proxy server is not running", null)
            return
        }

        try {
            val proxiedUrl = server.getProxiedUrl(backendUrl)
            promise.resolve(proxiedUrl)
        } catch (e: Exception) {
            promise.reject("URL_ERROR", e.message, e)
        }
    }

    /**
     * Set the authorization token for proxied requests
     */
    @ReactMethod
    fun setAuthToken(token: String?, promise: Promise) {
        authToken = token
        Log.d(TAG, "Auth token ${if (token != null) "set" else "cleared"}")
        promise.resolve(null)
    }
}
