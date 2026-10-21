package net.juspay.xynespaces.proxy

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import net.juspay.xynespaces.http.MtlsNetworkClient
import fi.iki.elonen.NanoHTTPD
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.InputStream
import java.net.URLDecoder
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/**
 * Local HTTP proxy server that forwards requests to backend with mTLS.
 * Allows React Native components (like video players) to access mTLS-protected resources
 * via plain HTTP localhost, while the proxy handles the mTLS authentication.
 */
class MtlsProxyServer(
    private val context: Context,
    port: Int = 0,
    allowedBaseUrl: String,
) : NanoHTTPD("127.0.0.1", port) {

    companion object {
        private const val TAG = "MtlsProxyServer"
        private const val PROXY_PATH = "/proxy"
        private const val MAX_REDIRECTS = 3

        // Headers that should be forwarded from client to backend.
        // Do not forward accept-encoding: OkHttp would gzip the body and drop
        // Content-Length, which breaks ExoPlayer progressive MP4 playback.
        private val FORWARD_REQUEST_HEADERS = setOf(
            "range",
            "accept",
            "accept-language",
            "cache-control",
            "user-agent",
            "authorization",
            "cookie"
        )

        // NanoHTTPD owns Content-Length / Transfer-Encoding. Forwarding both
        // (or chunked + Content-Length together) makes ExoPlayer reject the stream.
        private val FORWARD_RESPONSE_HEADERS = setOf(
            "content-type",
            "content-range",
            "accept-ranges",
            "etag",
            "last-modified",
            "cache-control",
            "expires"
        )
    }

    private val mtlsClient = MtlsNetworkClient(context)
    private var okHttpClient: OkHttpClient? = null
    private var okHttpSocketFactory: SSLSocketFactory? = null
    private var currentPort: Int = 0
    private val capability: String = createCapability()
    private val allowedOrigin: Origin
    private val allowedPathPrefix: String

    private data class Origin(val scheme: String, val host: String, val port: Int)

    private fun createCapability(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return android.util.Base64.encodeToString(
            bytes,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
        )
    }

    private fun parseAllowedPolicy(baseUrl: String): Pair<Origin, String> {
        val uri = URI(baseUrl)
        val scheme = uri.scheme?.lowercase()
        require(scheme == "https" || (scheme == "http" && isLoopbackHost(uri.host))) {
            "Proxy API base URL must use HTTPS unless it is an explicit loopback development URL"
        }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null && !uri.host.isNullOrBlank()) {
            "Proxy API base URL must not contain credentials or a fragment"
        }
        val port = if (uri.port == -1) if (scheme == "https") 443 else 80 else uri.port
        val path = (uri.rawPath ?: "").trimEnd('/')
        require(path.isNotEmpty()) { "Proxy API base URL must include an API path" }
        return Origin(scheme!!, uri.host.lowercase(), port) to "$path/attachments/"
    }

    private fun isLoopbackHost(host: String?): Boolean =
        host.equals("localhost", ignoreCase = true) || host == "127.0.0.1" || host == "::1"

    init {
        val policy = parseAllowedPolicy(allowedBaseUrl)
        allowedOrigin = policy.first
        allowedPathPrefix = policy.second
    }

    /**
     * The client for the current certificate. Built on first use rather than once at
     * start, so a proxy started before enrollment works after it, and rebuilt when the
     * certificate changes: MtlsNetworkClient hands out a new socket factory once its
     * cache has been cleared.
     */
    @Synchronized
    private fun currentClient(): OkHttpClient? {
        return try {
            val (socketFactory, trustManager) = mtlsClient.buildSslConfigWithTrustManager()
            okHttpClient?.takeIf { socketFactory === okHttpSocketFactory }
                ?: OkHttpClient.Builder()
                    .sslSocketFactory(socketFactory, trustManager)
                    .hostnameVerifier(HttpsURLConnection.getDefaultHostnameVerifier())
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(0, TimeUnit.SECONDS)
                    .writeTimeout(30, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true)
                    // Redirects are followed explicitly below so credentials and
                    // cookies never reach an unapproved origin or path.
                    .followRedirects(false)
                    .followSslRedirects(false)
                    .build()
                    .also {
                        okHttpClient = it
                        okHttpSocketFactory = socketFactory
                        Log.d(TAG, "mTLS client initialized for proxy")
                    }
        } catch (e: Exception) {
            Log.w(TAG, "mTLS not available, proxy will fail for mTLS endpoints: ${e.message}")
            null
        }
    }

    override fun start() {
        super.start()
        currentPort = listeningPort
        Log.i(TAG, "Proxy server started on port $currentPort")
    }

    /**
     * Get the port the server is listening on (useful when port 0 was used)
     */
    fun getPort(): Int = currentPort

    /**
     * Build a proxied URL for the given backend URL
     */
    fun getProxiedUrl(backendUrl: String): String {
        require(isAllowedTarget(backendUrl)) { "Proxy target is not allowed" }
        val encodedUrl = java.net.URLEncoder.encode(backendUrl, "UTF-8")
        val encodedCapability = java.net.URLEncoder.encode(capability, "UTF-8")
        return "http://127.0.0.1:$currentPort$PROXY_PATH?url=$encodedUrl&capability=$encodedCapability"
    }

    /**
     * Read exactly contentLength bytes from input stream.
     * Handles multiple reads needed for large bodies.
     */
    private fun readAllBytes(inputStream: java.io.InputStream, contentLength: Long): ByteArray {
        val result = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var remaining = contentLength

        while (remaining > 0) {
            val toRead = minOf(buffer.size.toLong(), remaining).toInt()
            val read = inputStream.read(buffer, 0, toRead)
            if (read == -1) {
                Log.w(TAG, "Input stream ended early, read ${result.size()} of $contentLength bytes")
                break
            }
            result.write(buffer, 0, read)
            remaining -= read
        }

        return result.toByteArray()
    }

    override fun serve(session: IHTTPSession): Response {
        // Only accept connections from localhost
        val remoteAddr = session.headers["remote-addr"] ?: ""
        if (remoteAddr != "127.0.0.1" && remoteAddr != "::1") {
            Log.w(TAG, "Rejecting connection from non-localhost: $remoteAddr")
            return newFixedLengthResponse(
                Response.Status.FORBIDDEN,
                MIME_PLAINTEXT,
                "Access denied"
            )
        }

        if (session.uri != PROXY_PATH) {
            return newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                MIME_PLAINTEXT,
                "Not Found",
            )
        }

        val requestCapability = session.parameters["capability"]?.firstOrNull()
        if (!constantTimeEquals(requestCapability, capability)) {
            return newFixedLengthResponse(
                Response.Status.FORBIDDEN,
                MIME_PLAINTEXT,
                "Invalid proxy capability",
            )
        }

        // Extract target URL from query parameters
        val urlParam = session.parameters["url"]?.firstOrNull()
        if (urlParam.isNullOrBlank()) {
            return newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                MIME_PLAINTEXT,
                "Missing 'url' query parameter"
            )
        }

        val targetUrl = try {
            URLDecoder.decode(urlParam, "UTF-8")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode proxy URL", e)
            return newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                MIME_PLAINTEXT,
                "Invalid URL encoding"
            )
        }

        if (!isAllowedTarget(targetUrl)) {
            Log.w(TAG, "Rejected proxy target")
            return newFixedLengthResponse(
                Response.Status.FORBIDDEN,
                MIME_PLAINTEXT,
                "Proxy target is not allowed",
            )
        }

        return try {
            proxyRequest(session, targetUrl)
        } catch (e: SecurityException) {
            Log.w(TAG, "Rejected proxy redirect: ${e.message}")
            newFixedLengthResponse(
                statusFromCode(502),
                MIME_PLAINTEXT,
                "Proxy redirect is not allowed",
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error proxying request: ${e.javaClass.simpleName}")
            newFixedLengthResponse(
                Response.Status.INTERNAL_ERROR,
                MIME_PLAINTEXT,
                "Proxy error: ${e.message}"
            )
        }
    }

    private fun isAllowedTarget(targetUrl: String): Boolean {
        return try {
            val uri = URI(targetUrl)
            val port = if (uri.port == -1) {
                if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
            } else {
                uri.port
            }
            val path = uri.rawPath ?: return false
            uri.scheme.equals(allowedOrigin.scheme, ignoreCase = true) &&
                uri.userInfo == null &&
                uri.fragment == null &&
                uri.host?.equals(allowedOrigin.host, ignoreCase = true) == true &&
                port == allowedOrigin.port &&
                path.startsWith(allowedPathPrefix) &&
                !path.contains("..") &&
                !path.contains("%2e", ignoreCase = true) &&
                !path.contains("%2f", ignoreCase = true) &&
                !path.contains("%5c", ignoreCase = true)
        } catch (_: Exception) {
            false
        }
    }

    private fun constantTimeEquals(actual: String?, expected: String): Boolean {
        if (actual == null) return false
        return MessageDigest.isEqual(
            actual.toByteArray(Charsets.UTF_8),
            expected.toByteArray(Charsets.UTF_8),
        )
    }

    private fun proxyRequest(session: IHTTPSession, targetUrl: String): Response {
        val okHttp = currentClient()
            ?: return newFixedLengthResponse(
                Response.Status.SERVICE_UNAVAILABLE,
                MIME_PLAINTEXT,
                "mTLS client not available"
            )

        // Build request headers
        val requestBuilder = Request.Builder().url(targetUrl)

        // Forward relevant request headers
        session.headers.forEach { (key, value) ->
            val lowerKey = key.lowercase()
            if (lowerKey in FORWARD_REQUEST_HEADERS || lowerKey.startsWith("x-")) {
                requestBuilder.header(key, value)
            }
        }

        // ExoPlayer talks to 127.0.0.1 and will not send API cookies. Inject them
        // the same way mtlsFetch does, otherwise /stream can 401 on Android.
        if (!session.headers.containsKey("cookie")) {
            try {
                val cookie = CookieManager.getInstance().getCookie(targetUrl)
                if (!cookie.isNullOrBlank()) {
                    requestBuilder.header("Cookie", cookie)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to read CookieManager for approved proxy target")
            }
        }

        // Inject authorization header if available and not already present
        val authToken = MtlsProxyModule.getAuthToken()
        if (authToken != null && !session.headers.containsKey("authorization")) {
            requestBuilder.header("Authorization", "Bearer $authToken")
            Log.d(TAG, "Injected Authorization header for approved proxy target")
        }

        // Keep the body uncompressed so Content-Length stays valid for seeking.
        requestBuilder.header("Accept-Encoding", "identity")

        // Handle different HTTP methods
        val method = session.method
        val body = if (method == Method.POST || method == Method.PUT || method == Method.PATCH) {
            val contentLength = session.headers["content-length"]?.toLongOrNull() ?: 0L
            if (contentLength > 0) {
                // Read all bytes from input stream (may require multiple reads for large bodies)
                val bytes = readAllBytes(session.inputStream, contentLength)
                val contentType = session.headers["content-type"] ?: "application/octet-stream"
                bytes.toRequestBody(contentType.toMediaTypeOrNull())
            } else {
                null
            }
        } else {
            null
        }

        requestBuilder.method(method.name, body)

        // Execute the request with mTLS. OkHttp redirects are disabled on the
        // client; only same-origin attachment redirects are followed here.
        val okResponse = executeApprovedRequest(okHttp, requestBuilder.build())

        // Build response. Never remap 206 → 200: ExoPlayer requires Partial Content
        // when it sent Range and the upstream returned Content-Range.
        val statusCode = okResponse.code
        val status = statusFromCode(statusCode)

        val responseHeaders = mutableMapOf<String, String>()
        okResponse.headers.names().forEach { name ->
            val lowerName = name.lowercase()
            if (lowerName in FORWARD_RESPONSE_HEADERS) {
                responseHeaders[name] = okResponse.header(name) ?: ""
            }
        }

        val responseBody = okResponse.body
        val mimeType = resolveMimeType(okResponse, targetUrl)
        val looksLikeNonVideo =
            mimeType.startsWith("text/") || mimeType.contains("json") || mimeType.contains("html")

        // ExoPlayer sniffs a successful body as MP4, so an error page sent with a 2xx
        // surfaces as "None of the available extractors could read the stream". Non-2xx
        // responses are left alone: the player already fails on the status, and needs
        // their headers — a 416 at end of file carries the Content-Range it stops on.
        if (isVideoStream(targetUrl) && statusCode in 200..299 && looksLikeNonVideo) {
            okResponse.close()
            Log.w(TAG, "Refusing to feed non-video /stream to player mime=$mimeType")
            return newFixedLengthResponse(
                Response.Status.BAD_REQUEST,
                MIME_PLAINTEXT,
                "Video stream is not available ($mimeType)",
            )
        }
        val contentLength = responseBody?.contentLength() ?: -1L
        val inputStream = closeWithResponse(
            responseBody?.byteStream() ?: ByteArrayInputStream(ByteArray(0)),
            okResponse,
        )

        Log.d(
            TAG,
            "Proxied approved target status=$statusCode mime=$mimeType length=$contentLength range=${okResponse.header("content-range")}",
        )

        val response = if (contentLength >= 0L) {
            newFixedLengthResponse(status, mimeType, inputStream, contentLength)
        } else {
            newChunkedResponse(status, mimeType, inputStream)
        }

        return response.apply {
            responseHeaders.forEach { (name, value) ->
                addHeader(name, value)
            }
            if (!responseHeaders.keys.any { it.equals("accept-ranges", ignoreCase = true) }) {
                addHeader("Accept-Ranges", "bytes")
            }
        }
    }

    /** The path, not the whole URL: a query string can contain "/stream" too. */
    private fun isVideoStream(targetUrl: String): Boolean =
        targetUrl.substringBefore('?').substringBefore('#').endsWith("/stream")

    private fun executeApprovedRequest(
        okHttp: OkHttpClient,
        initialRequest: Request,
    ): okhttp3.Response {
        var request = initialRequest

        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            val response = okHttp.newCall(request).execute()
            if (response.code !in 300..399) {
                return response
            }

            val location = response.header("Location")
            val redirectedUrl = location?.let { request.url.resolve(it) }
            val redirectedTarget = redirectedUrl?.toString()
            if (redirectedUrl == null || redirectedTarget == null || !isAllowedTarget(redirectedTarget)) {
                response.close()
                throw SecurityException("redirect target is outside the approved origin/path")
            }

            response.close()
            if (redirectCount == MAX_REDIRECTS) {
                throw SecurityException("redirect limit exceeded")
            }

            // Keep the existing method and range headers for approved media
            // redirects; the target has already passed the exact allowlist.
            request = request.newBuilder().url(redirectedUrl).build()
        }

        throw SecurityException("redirect limit exceeded")
    }

    private fun statusFromCode(statusCode: Int): Response.IStatus {
        Response.Status.lookup(statusCode)?.let { return it }
        return object : Response.IStatus {
            override fun getRequestStatus(): Int = statusCode
            override fun getDescription(): String = "HTTP $statusCode"
        }
    }

    private fun resolveMimeType(okResponse: okhttp3.Response, targetUrl: String): String {
        val raw = okResponse.header("content-type")
            ?: okResponse.body?.contentType()?.toString()
            ?: ""
        val mime = raw.substringBefore(';').trim()
        if (mime.isNotEmpty() && mime != "*/*") {
            return mime
        }
        val isSuccess = okResponse.code in 200..299
        if (isSuccess && targetUrl.contains("/stream")) {
            return "video/mp4"
        }
        return "application/octet-stream"
    }

    private fun closeWithResponse(stream: InputStream, okResponse: okhttp3.Response): InputStream {
        return object : FilterInputStream(stream) {
            override fun close() {
                try {
                    super.close()
                } finally {
                    okResponse.close()
                }
            }
        }
    }
}
