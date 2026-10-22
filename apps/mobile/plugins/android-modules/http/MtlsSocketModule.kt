package net.juspay.xynespaces.http

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HttpsURLConnection

class MtlsSocketModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "MtlsSocketModule"
        const val EVENT_NAME = "mtlsWebSocketEvent"

        private val nextSocketId = AtomicInteger(1)
        private val sockets = ConcurrentHashMap<Int, ManagedSocket>()
    }

    private data class ManagedSocket(
        val client: OkHttpClient,
        val socket: WebSocket,
    )

    override fun getName(): String = NAME

    @ReactMethod
    fun addListener(eventName: String) {
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }

    @ReactMethod
    fun connect(url: String, protocols: ReadableArray?, headers: ReadableMap?, promise: Promise) {
        try {
            if (!MtlsTransportPolicy.isApprovedWebSocketUrl(url)) {
                promise.reject("UNAPPROVED_DESTINATION", "WebSocket destination is not approved")
                return
            }
            val mtlsClient = MtlsNetworkClient(reactContext.applicationContext)
            val (socketFactory, trustManager) = mtlsClient.buildSslConfigWithTrustManager()

            val client = OkHttpClient.Builder()
                .sslSocketFactory(socketFactory, trustManager)
                .hostnameVerifier(HttpsURLConnection.getDefaultHostnameVerifier())
                // Revalidate any redirect at the caller boundary; never move the client
                // certificate to an implicit destination.
                .followRedirects(false)
                .followSslRedirects(false)
                .build()

            val requestBuilder = Request.Builder().url(url)
            protocols?.let {
                val values = mutableListOf<String>()
                for (index in 0 until it.size()) {
                    val value = it.getString(index)?.trim()
                    if (!value.isNullOrEmpty()) {
                        values.add(value)
                    }
                }
                if (values.isNotEmpty()) {
                    requestBuilder.header("Sec-WebSocket-Protocol", values.joinToString(","))
                }
            }

            headers?.let { headerMap ->
                val iterator = headerMap.keySetIterator()
                while (iterator.hasNextKey()) {
                    val key = iterator.nextKey()
                    val value = headerMap.getString(key)?.trim()
                    if (!key.isNullOrEmpty() && !value.isNullOrEmpty()) {
                        requestBuilder.header(key, value)
                    }
                }
            }

            val socketId = nextSocketId.getAndIncrement()
            val request = requestBuilder.build()
            val socket = client.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        sockets[socketId] = ManagedSocket(client, webSocket)
                        emitEvent(socketId, "open")
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        emitEvent(socketId, "message", mapOf("data" to text))
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        webSocket.close(code, reason)
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        sockets.remove(socketId)
                        emitEvent(
                            socketId,
                            "close",
                            mapOf("code" to code, "reason" to reason, "wasClean" to true),
                        )
                        client.dispatcher.executorService.shutdown()
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        sockets.remove(socketId)
                        emitEvent(
                            socketId,
                            "error",
                            mapOf("message" to (t.message ?: "Unknown WebSocket failure")),
                        )
                        emitEvent(
                            socketId,
                            "close",
                            mapOf(
                                "code" to 1006,
                                "reason" to (t.message ?: "Abnormal closure"),
                                "wasClean" to false,
                            ),
                        )
                        client.dispatcher.executorService.shutdown()
                    }
                },
            )

            sockets[socketId] = ManagedSocket(client, socket)
            promise.resolve(socketId)
        } catch (e: Exception) {
            promise.reject("MTLS_SOCKET_CONNECT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun send(socketId: Int, data: String, promise: Promise) {
        val managedSocket = sockets[socketId]
        if (managedSocket == null) {
            promise.reject("MTLS_SOCKET_NOT_FOUND", "Socket $socketId not found")
            return
        }

        val didSend = managedSocket.socket.send(data)
        if (didSend) {
            promise.resolve(true)
        } else {
            promise.reject("MTLS_SOCKET_SEND_FAILED", "Socket $socketId rejected outbound message")
        }
    }

    @ReactMethod
    fun close(socketId: Int, code: Int?, reason: String?, promise: Promise) {
        val managedSocket = sockets.remove(socketId)
        if (managedSocket == null) {
            promise.resolve(false)
            return
        }

        managedSocket.socket.close(code ?: 1000, reason ?: "")
        managedSocket.client.dispatcher.executorService.shutdown()
        promise.resolve(true)
    }

    private fun emitEvent(socketId: Int, type: String, fields: Map<String, Any?> = emptyMap()) {
        val payload = Arguments.createMap().apply {
            putInt("socketId", socketId)
            putString("type", type)
            fields.forEach { (key, value) ->
                when (value) {
                    null -> putNull(key)
                    is Boolean -> putBoolean(key, value)
                    is Int -> putInt(key, value)
                    is Double -> putDouble(key, value)
                    is String -> putString(key, value)
                    else -> putString(key, value.toString())
                }
            }
        }

        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT_NAME, payload)
    }
}
