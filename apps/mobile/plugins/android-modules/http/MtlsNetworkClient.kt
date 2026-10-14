package net.juspay.xynespaces.http

import android.content.Context
import net.juspay.xynespaces.BuildConfig
import android.os.StatFs
import android.util.Log
import android.webkit.CookieManager
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.security.KeyStore
import java.security.SecureRandom
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import org.json.JSONObject

data class MtlsResponse(
    val statusCode: Int,
    val body: String,
    val headers: Map<String, String>,
    val isBase64: Boolean = true
)

data class MtlsFileDownloadResult(
    val statusCode: Int,
    val filePath: String?,
    val byteCount: Long,
    val mimeType: String?,
    val headers: Map<String, String>,
    val errorBody: String = "",
)

data class MultipartFile(
    val fieldName: String,
    val filePath: String,
    val fileName: String,
    val mimeType: String
)

class MtlsNetworkClient(private val context: Context) {

    companion object {
        private const val TAG = "MtlsNetworkClient"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "ClientIdentity"
        private const val DOWNLOAD_BUFFER_BYTES = 64 * 1024
        private const val ERROR_BODY_LIMIT_BYTES = 16 * 1024
        private const val DISK_SPACE_MARGIN_BYTES = 2L * 1024L * 1024L
        private const val DOWNLOAD_CONNECT_TIMEOUT_MS = 30_000
        private const val DOWNLOAD_READ_TIMEOUT_MS = 180_000
        private const val CANCEL_WATCHDOG_INTERVAL_MS = 250L
        private const val MAX_DOWNLOAD_REDIRECTS = 5
        // One SSLContext per process. Handshake crypto is expensive (CPU + battery).
        @Volatile
        private var cachedSocketFactory: SSLSocketFactory? = null
        @Volatile
        private var cachedTrustManager: X509TrustManager? = null
        private val sslLock = Any()

        // Hard cap for performMtlsRequest bodies. Files must use downloadToFile.
        // 8 MB JSON as UTF-16 string ≈ 16 MB. Above that we refuse rather than OOM.
        private const val JSON_BODY_HARD_MAX_BYTES = 8 * 1024 * 1024

        /** Space, tab, line feed, carriage return — what JSON allows before a value. */
        private val JSON_WHITESPACE = setOf(0x20, 0x09, 0x0A, 0x0D)

        fun clearSslCache() {
            synchronized(sslLock) {
                cachedSocketFactory = null
                cachedTrustManager = null
            }
        }

        /** Throws unless [urlString] may receive the app's mTLS credentials (see MtlsTransportPolicy). */
        @Suppress("UNUSED_PARAMETER")
        fun assertApprovedDownloadUrl(context: Context, urlString: String) {
            if (!MtlsTransportPolicy.isApprovedHttpUrl(urlString)) {
                throw IllegalArgumentException("Download destination is not allowed")
            }
        }
    }

    fun makeMtlsRequest(
        urlString: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: String? = null
    ): MtlsResponse {
        return makeMtlsConnection(urlString, method, headers, body?.toByteArray(Charsets.UTF_8))
    }

    fun downloadToFile(
        urlString: String,
        destinationPath: String,
        headers: Map<String, String> = emptyMap(),
        resume: Boolean = false,
        cancelRequested: () -> Boolean = { false },
        onProgress: (bytesWritten: Long, contentLength: Long) -> Unit = { _, _ -> },
    ): MtlsFileDownloadResult = downloadToFile(
        urlString = urlString,
        destinationPath = destinationPath,
        headers = headers,
        resume = resume,
        cancelRequested = cancelRequested,
        onProgress = onProgress,
        allowRestart = true,
    )

    private fun downloadToFile(
        urlString: String,
        destinationPath: String,
        headers: Map<String, String>,
        resume: Boolean,
        cancelRequested: () -> Boolean,
        onProgress: (bytesWritten: Long, contentLength: Long) -> Unit,
        allowRestart: Boolean,
    ): MtlsFileDownloadResult {
        require(MtlsTransportPolicy.isApprovedHttpUrl(urlString)) {
            "HTTP download destination is not approved"
        }

        val destination = File(stripFileScheme(destinationPath))
        val partFile = File("${destination.absolutePath}.part")
        val validatorFile = File("${partFile.absolutePath}.meta")
        destination.parentFile?.mkdirs()

        var existingBytes = 0L
        var storedValidators = DownloadValidators.EMPTY
        if (resume && partFile.exists()) {
            existingBytes = partFile.length()
            storedValidators = readDownloadValidators(validatorFile)
        } else if (partFile.exists() && !partFile.delete()) {
            throw IOException("Failed to clear incomplete download: ${partFile.absolutePath}")
        } else {
            validatorFile.delete()
        }

        val requestedHeaders = headers.toMutableMap()
        if (existingBytes > 0L) {
            requestedHeaders["Range"] = "bytes=$existingBytes-"
            storedValidators.ifRangeValue()?.let { requestedHeaders["If-Range"] = it }
        }

        val originalUrl = URL(urlString)
        var requestUrl = originalUrl
        var connection: HttpURLConnection? = null
        var redirectCount = 0
        try {
            var activeConnection: HttpURLConnection
            while (true) {
                if (cancelRequested()) throw IOException("Download cancelled")
                val candidate = openDownloadConnection(requestUrl, requestedHeaders)
                connection = candidate
                candidate.connect()
                val responseCode = candidate.responseCode
                if (responseCode !in 300..399) {
                    activeConnection = candidate
                    break
                }

                val location = candidate.getHeaderField("Location")
                val redirectedUrl = location?.let { URL(requestUrl, it) }
                candidate.disconnect()
                connection = null

                if (
                    redirectedUrl == null ||
                    !isSameOrigin(originalUrl, redirectedUrl) ||
                    !MtlsTransportPolicy.isApprovedHttpUrl(redirectedUrl.toExternalForm())
                ) {
                    throw SecurityException("Download redirect is outside the approved origin")
                }
                if (redirectCount >= MAX_DOWNLOAD_REDIRECTS) {
                    throw SecurityException("Download redirect limit exceeded")
                }
                redirectCount += 1
                requestUrl = redirectedUrl
            }
            val statusCode = activeConnection.responseCode
            val responseHeaders = collectResponseHeaders(activeConnection, requestUrl)
            val mimeType = activeConnection.contentType?.substringBefore(';')?.trim()

            if (statusCode == 416 && existingBytes > 0L && allowRestart) {
                Log.w(TAG, "Range not satisfiable (416); restarting download")
                return restartDownload(
                    connection = activeConnection,
                    partFile = partFile,
                    validatorFile = validatorFile,
                    urlString = urlString,
                    destinationPath = destinationPath,
                    headers = headers,
                    cancelRequested = cancelRequested,
                    onProgress = onProgress,
                )
            }

            if (statusCode !in 200..299) {
                val preview = readLimitedUtf8(
                    activeConnection.errorStream ?: activeConnection.inputStream,
                    ERROR_BODY_LIMIT_BYTES,
                )
                return MtlsFileDownloadResult(
                    statusCode = statusCode,
                    filePath = null,
                    byteCount = existingBytes,
                    mimeType = mimeType,
                    headers = responseHeaders,
                    errorBody = preview,
                )
            }

            val responseValidators = DownloadValidators(
                etag = activeConnection.getHeaderField("ETag"),
                lastModified = activeConnection.getHeaderField("Last-Modified"),
            )
            val contentRange = parseContentRange(activeConnection.getHeaderField("Content-Range"))

            // Server ignored Range and sent the whole file.
            var append = false
            if (existingBytes > 0L && statusCode == 206) {
                val rangeStartsAtPart = contentRange?.start == existingBytes
                val sameObject = storedValidators.matches(responseValidators)
                if (rangeStartsAtPart && sameObject) {
                    append = true
                } else if (allowRestart) {
                    Log.w(
                        TAG,
                        "Partial response did not match local .part (rangeStart=${contentRange?.start} existing=$existingBytes); restarting download",
                    )
                    return restartDownload(
                        connection = activeConnection,
                        partFile = partFile,
                        validatorFile = validatorFile,
                        urlString = urlString,
                        destinationPath = destinationPath,
                        headers = headers,
                        cancelRequested = cancelRequested,
                        onProgress = onProgress,
                    )
                } else {
                    throw IOException("Cannot resume download: invalid partial response")
                }
            } else if (existingBytes > 0L && statusCode == 200) {
                existingBytes = 0L
                storedValidators = DownloadValidators.EMPTY
                if (!partFile.delete() && partFile.exists()) {
                    throw IOException("Failed to reset download for non-partial response")
                }
                validatorFile.delete()
            }

            writeDownloadValidators(
                validatorFile,
                responseValidators,
            )

            val totalLength = parseTotalLength(
                statusCode = statusCode,
                contentRange = activeConnection.getHeaderField("Content-Range"),
                contentLength = activeConnection.contentLengthLong,
                existingBytes = if (append) existingBytes else 0L,
            )

            if (totalLength > 0L) {
                assertEnoughDiskSpace(destination, totalLength - existingBytes)
            }

            var lastProgressAt = 0L
            val reading = AtomicBoolean(true)
            val cancelWatchdog = Thread({
                while (reading.get()) {
                    if (cancelRequested()) {
                        try {
                            activeConnection.disconnect()
                        } catch (_: Exception) {
                        }
                        return@Thread
                    }
                    try {
                        Thread.sleep(CANCEL_WATCHDOG_INTERVAL_MS)
                    } catch (_: InterruptedException) {
                        return@Thread
                    }
                }
            }, "mtls-download-cancel").apply {
                isDaemon = true
                start()
            }
            val bytesWritten = try {
                activeConnection.inputStream.use { input ->
                    FileOutputStream(partFile, append).buffered(DOWNLOAD_BUFFER_BYTES).use { output ->
                        val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
                        var total = if (append) existingBytes else 0L
                        onProgress(total, totalLength)
                        while (true) {
                            if (cancelRequested()) throw IOException("Download cancelled")
                            val read = try {
                                input.read(buffer)
                            } catch (error: SocketTimeoutException) {
                                if (cancelRequested()) throw IOException("Download cancelled")
                                throw IOException("Download stalled: no data for ${DOWNLOAD_READ_TIMEOUT_MS}ms", error)
                            } catch (error: IOException) {
                                if (cancelRequested()) throw IOException("Download cancelled")
                                throw error
                            }
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            total += read
                            val now = System.currentTimeMillis()
                            if (now - lastProgressAt >= 250L) {
                                lastProgressAt = now
                                onProgress(total, totalLength)
                            }
                        }
                        output.flush()
                        onProgress(total, totalLength)
                        total
                    }
                }
            } finally {
                reading.set(false)
                cancelWatchdog.interrupt()
            }

            if (totalLength > 0L && bytesWritten != totalLength) {
                throw IOException("Incomplete download: expected $totalLength bytes, got $bytesWritten")
            }

            publishPartFile(partFile, destination)
            validatorFile.delete()
            Log.d(TAG, "Downloaded $bytesWritten bytes to ${destination.absolutePath} status=$statusCode")

            return MtlsFileDownloadResult(
                statusCode = statusCode,
                filePath = destination.absolutePath,
                byteCount = bytesWritten,
                mimeType = mimeType,
                headers = responseHeaders,
            )
        } catch (error: Exception) {
            if (error.message == "Download cancelled") {
                partFile.delete()
                validatorFile.delete()
                destination.takeIf { it.exists() && it.length() == 0L }?.delete()
            }
            Log.e(TAG, "Download failed: ${error.javaClass.simpleName}: ${error.message}")
            throw error
        } finally {
            try {
                connection?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private fun restartDownload(
        connection: HttpURLConnection,
        partFile: File,
        validatorFile: File,
        urlString: String,
        destinationPath: String,
        headers: Map<String, String>,
        cancelRequested: () -> Boolean,
        onProgress: (bytesWritten: Long, contentLength: Long) -> Unit,
    ): MtlsFileDownloadResult {
        try {
            connection.disconnect()
        } catch (_: Exception) {
        }
        partFile.delete()
        validatorFile.delete()
        return downloadToFile(
            urlString = urlString,
            destinationPath = destinationPath,
            headers = headers,
            resume = false,
            cancelRequested = cancelRequested,
            onProgress = onProgress,
            allowRestart = false,
        )
    }

    private fun openDownloadConnection(url: URL, headers: Map<String, String>): HttpURLConnection {
        val connection = when (url.protocol.lowercase()) {
            "https" -> {
                val httpsConnection = url.openConnection() as HttpsURLConnection
                if (BuildConfig.MTLS_ENABLED) {
                    val (socketFactory, hostnameVerifier) = buildSslConfig()
                    httpsConnection.sslSocketFactory = socketFactory
                    httpsConnection.hostnameVerifier = hostnameVerifier
                }
                httpsConnection
            }
            "http" -> {
                Log.w(TAG, "Using non-mTLS HTTP connection for URL: $url")
                url.openConnection() as HttpURLConnection
            }
            else -> throw IllegalArgumentException("Unsupported URL protocol: ${url.protocol}")
        }

        return connection.apply {
            connectTimeout = DOWNLOAD_CONNECT_TIMEOUT_MS
            readTimeout = DOWNLOAD_READ_TIMEOUT_MS
            requestMethod = "GET"
            doInput = true
            doOutput = false
            useCaches = false
            // Redirects are checked against the transport allowlist by the
            // download loop before a new connection is opened.
            instanceFollowRedirects = false
            setRequestProperty("Accept-Encoding", "identity")
            headers.forEach { (key, value) -> setRequestProperty(key, value) }
        }
    }

    private fun isSameOrigin(first: URL, second: URL): Boolean {
        val firstScheme = first.protocol.lowercase()
        val secondScheme = second.protocol.lowercase()
        if (firstScheme != secondScheme) return false
        val firstPort = if (first.port >= 0) first.port else first.defaultPort
        val secondPort = if (second.port >= 0) second.port else second.defaultPort
        return first.host.equals(second.host, ignoreCase = true) && firstPort == secondPort
    }

    private fun collectResponseHeaders(connection: HttpURLConnection, url: URL): Map<String, String> {
        val responseHeaders = mutableMapOf<String, String>()
        val cookieManager = CookieManager.getInstance()
        val cookieOrigin = "${url.protocol}://${url.host}" + if (url.port != -1) ":${url.port}" else ""

        connection.headerFields?.forEach { key, values ->
            if (key == null || values.isNullOrEmpty()) return@forEach
            val lowerKey = key.lowercase()
            if (lowerKey == "set-cookie") {
                values.forEach { cookieValue -> cookieManager.setCookie(cookieOrigin, cookieValue) }
                cookieManager.flush()
                responseHeaders[lowerKey] = values.joinToString("\n")
            } else {
                responseHeaders[lowerKey] = values.joinToString(",")
            }
        }
        return responseHeaders
    }

    private fun parseTotalLength(
        statusCode: Int,
        contentRange: String?,
        contentLength: Long,
        existingBytes: Long,
    ): Long {
        if (statusCode == 206 && !contentRange.isNullOrBlank()) {
            val parsed = parseContentRange(contentRange)
            if (parsed?.total != null && parsed.total > 0L) {
                return parsed.total
            }
            val slash = contentRange.lastIndexOf('/')
            if (slash >= 0) {
                val total = contentRange.substring(slash + 1).trim()
                if (total != "*") return total.toLongOrNull() ?: -1L
            }
        }
        if (contentLength > 0L) return existingBytes + contentLength
        return -1L
    }

    private fun parseContentRange(header: String?): ParsedContentRange? {
        if (header.isNullOrBlank()) return null
        val trimmed = header.trim()
        if (!trimmed.startsWith("bytes", ignoreCase = true)) return null
        val rest = trimmed.substring(5).trim()
        val slash = rest.lastIndexOf('/')
        if (slash < 0) return null
        val rangePart = rest.substring(0, slash).trim()
        val dash = rangePart.indexOf('-')
        if (dash < 0) return null
        val start = rangePart.substring(0, dash).trim().toLongOrNull() ?: return null
        val end = rangePart.substring(dash + 1).trim().toLongOrNull()
        val totalRaw = rest.substring(slash + 1).trim()
        val total = if (totalRaw == "*") null else totalRaw.toLongOrNull()
        return ParsedContentRange(start = start, end = end, total = total)
    }

    private fun readDownloadValidators(file: File): DownloadValidators {
        if (!file.isFile) return DownloadValidators.EMPTY
        return try {
            val obj = JSONObject(file.readText())
            DownloadValidators(
                etag = obj.optString("etag").takeIf { it.isNotBlank() },
                lastModified = obj.optString("lastModified").takeIf { it.isNotBlank() },
            )
        } catch (_: Exception) {
            DownloadValidators.EMPTY
        }
    }

    private fun writeDownloadValidators(file: File, validators: DownloadValidators) {
        if (!validators.hasUsableValidator()) {
            file.delete()
            return
        }
        try {
            file.writeText(
                JSONObject().apply {
                    validators.etag?.let { put("etag", it) }
                    validators.lastModified?.let { put("lastModified", it) }
                }.toString(),
            )
        } catch (error: Exception) {
            Log.w(TAG, "Failed to persist download validators: ${error.message}")
        }
    }

    private data class ParsedContentRange(
        val start: Long,
        val end: Long?,
        val total: Long?,
    )

    private data class DownloadValidators(
        val etag: String?,
        val lastModified: String?,
    ) {
        private fun strongEtag(): String? = etag
            ?.trim()
            ?.takeIf { it.isNotEmpty() && !it.startsWith("W/", ignoreCase = true) }

        private fun usableLastModified(): String? = lastModified
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

        fun hasUsableValidator(): Boolean = strongEtag() != null || usableLastModified() != null

        fun ifRangeValue(): String? =
            strongEtag() ?: usableLastModified()

        fun matches(other: DownloadValidators): Boolean {
            val storedEtag = strongEtag()
            val responseEtag = other.strongEtag()
            if (storedEtag != null || responseEtag != null) {
                return storedEtag != null && storedEtag == responseEtag
            }

            val storedLastModified = usableLastModified()
            val responseLastModified = other.usableLastModified()
            return storedLastModified != null && storedLastModified == responseLastModified
        }

        companion object {
            val EMPTY = DownloadValidators(null, null)
        }
    }

    private fun assertEnoughDiskSpace(destination: File, contentLength: Long) {
        val parent = destination.parentFile ?: return
        val available = StatFs(parent.absolutePath).availableBytes
        val required = contentLength + DISK_SPACE_MARGIN_BYTES
        if (available < required) {
            throw IOException("Not enough free space to download file (${required} bytes required)")
        }
    }

    private fun publishPartFile(partFile: File, destination: File) {
        if (destination.exists() && !destination.delete()) {
            throw IOException("Failed to replace destination file: ${destination.absolutePath}")
        }
        if (!partFile.renameTo(destination)) {
            partFile.copyTo(destination, overwrite = true)
            if (!partFile.delete()) {
                Log.w(TAG, "Copied download but failed to delete part file: ${partFile.absolutePath}")
            }
        }
    }

    private fun readLimitedUtf8(stream: java.io.InputStream?, limit: Int): String {
        if (stream == null) return ""
        return stream.use { input ->
            val buffer = ByteArray(limit)
            val read = input.read(buffer)
            if (read <= 0) "" else String(buffer, 0, read, Charsets.UTF_8)
        }
    }

    private fun stripFileScheme(path: String): String {
        val withoutScheme = if (path.startsWith("file://")) path.removePrefix("file://") else path
        return try {
            java.net.URLDecoder.decode(withoutScheme, Charsets.UTF_8.name())
        } catch (_: Exception) {
            withoutScheme
        }
    }

    // Map overload kept for backward-compat (performMtlsMultipartUpload RN bridge uses ReadableMap)
    fun makeMtlsMultipartUpload(
        urlString: String,
        fields: Map<String, String> = emptyMap(),
        files: List<MultipartFile>,
        headers: Map<String, String> = emptyMap()
    ): MtlsResponse = makeMtlsMultipartUpload(urlString, fields.map { (k, v) -> k to v }, files, headers)

    // List overload preserves repeated field names (e.g. multiple `tags` values)
    fun makeMtlsMultipartUpload(
        urlString: String,
        fieldPairs: List<Pair<String, String>>,
        files: List<MultipartFile>,
        headers: Map<String, String> = emptyMap()
    ): MtlsResponse {
        val boundary = "----FormBoundary${System.currentTimeMillis()}"
        val contentType = "multipart/form-data; boundary=$boundary"

        val requestHeaders = headers.toMutableMap()
        requestHeaders["Content-Type"] = contentType

        return makeMtlsConnectionWithStreaming(urlString, "POST", requestHeaders, boundary, fieldPairs, files)
    }

    /**
     * Bodies that start like JSON are passed on as text; anything else is base64, since
     * decoding binary as UTF-8 would corrupt it.
     *
     * Only the first byte is inspected. Parsing here built a whole JSONObject just to
     * throw it away, and buildResult then parsed the body a second time.
     */
    private fun decodeResponseBody(bytes: ByteArray): Pair<String, Boolean> {
        val first = bytes.firstOrNull { it.toInt() !in JSON_WHITESPACE }?.toInt()
            ?: return "" to false

        return if (first == '{'.code || first == '['.code) {
            bytes.toString(Charsets.UTF_8) to false
        } else {
            android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP) to true
        }
    }

    /**
     * Copy an InputStream into a byte[] but never grow past [maxBytes].
     * Kotlin's InputStream.readBytes() has no cap and doubles a ByteArrayOutputStream
     * until the file is complete — that is the Crashlytics OOM path.
     */
    private fun readCapped(stream: java.io.InputStream, maxBytes: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(minOf(maxBytes, 32 * 1024))
        val buf = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val n = stream.read(buf)
            if (n < 0) break
            total += n
            if (total > maxBytes) {
                throw IOException("mTLS response exceeded $maxBytes bytes")
            }
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun calculateContentLength(
        boundary: String,
        fieldPairs: List<Pair<String, String>>,
        files: List<MultipartFile>
    ): Long {
        val crlf = "\r\n"
        val twoHyphens = "--"
        var totalLength = 0L

        fieldPairs.forEach { (key, value) ->
            totalLength += (twoHyphens + boundary + crlf).length
            totalLength += ("Content-Disposition: form-data; name=\"$key\"$crlf$crlf").length
            totalLength += value.toByteArray(Charsets.UTF_8).size
            totalLength += crlf.length
        }

        files.forEach { file ->
            totalLength += (twoHyphens + boundary + crlf).length
            totalLength += ("Content-Disposition: form-data; name=\"${file.fieldName}\"; filename=\"${file.fileName}\"$crlf").length
            totalLength += ("Content-Type: ${file.mimeType}$crlf$crlf").length
            totalLength += java.io.File(file.filePath).length()
            totalLength += crlf.length
        }

        totalLength += (twoHyphens + boundary + twoHyphens + crlf).length

        return totalLength
    }

    private fun makeMtlsConnection(
        urlString: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        bodyBytes: ByteArray? = null
    ): MtlsResponse {
        return makeMtlsConnectionInternal(urlString, method, headers, bodyBytes, null, null, null)
    }

    private fun makeMtlsConnectionWithStreaming(
        urlString: String,
        method: String = "POST",
        headers: Map<String, String> = emptyMap(),
        boundary: String,
        fieldPairs: List<Pair<String, String>>,
        files: List<MultipartFile>
    ): MtlsResponse {
        return makeMtlsConnectionInternal(urlString, method, headers, null, boundary, fieldPairs, files)
    }

    private fun makeMtlsConnectionInternal(
        urlString: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        bodyBytes: ByteArray? = null,
        boundary: String? = null,
        fieldPairs: List<Pair<String, String>>? = null,
        files: List<MultipartFile>? = null
    ): MtlsResponse {
        try {
            require(MtlsTransportPolicy.isApprovedHttpUrl(urlString)) {
                "HTTP destination is not approved"
            }
            val url = URL(urlString)
            val normalizedMethod = method.uppercase()
            val isMultipartStreaming = boundary != null && fieldPairs != null && files != null

            val connection = when (url.protocol.lowercase()) {
                "https" -> {
                    val httpsConnection = url.openConnection() as HttpsURLConnection
                    if (BuildConfig.MTLS_ENABLED) {
                        val (socketFactory, hv) = buildSslConfig()
                        httpsConnection.apply {
                            sslSocketFactory = socketFactory
                            hostnameVerifier = hv
                        }
                    }
                    httpsConnection
                }

                "http" -> {
                    Log.w(TAG, "Using non-mTLS HTTP connection for URL: $urlString")
                    url.openConnection() as HttpURLConnection
                }

                else -> throw IllegalArgumentException("Unsupported URL protocol: ${url.protocol}")
            }.apply {
                connectTimeout = 10000
                readTimeout = 120000 // Longer timeout for file uploads
                // Direct mTLS requests must not follow redirects implicitly. A redirect can
                // move credentials or the client certificate to an unapproved destination.
                instanceFollowRedirects = false
                requestMethod = normalizedMethod
                doInput = true
                doOutput = bodyBytes != null || isMultipartStreaming
                useCaches = false
                headers.forEach { (k, v) -> setRequestProperty(k, v) }

                // Enable streaming mode for large file uploads to avoid OOM
                if (isMultipartStreaming) {
                    setChunkedStreamingMode(0)
                }
            }

            if (connection.doOutput) {
                connection.outputStream.use { os ->
                    if (isMultipartStreaming) {
                        // Stream multipart data directly without loading into memory
                        streamMultipartBody(os, boundary!!, fieldPairs!!, files!!)
                    } else if (bodyBytes != null) {
                        os.write(bodyBytes)
                    }
                    os.flush()
                }
            }

            return try {
                connection.connect()

                val responseCode = connection.responseCode
                val responseStream = if (responseCode in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream ?: connection.inputStream
                }
                // buildResult() will parse a JSON text body into a WritableMap/WritableArray
                // before passing it to the bridge, avoiding expensive bridge quote-escaping of
                // large JSON strings. Non-JSON bodies (binary images/videos, HTML, plain text)
                // come back base64-encoded so the bytes survive the bridge intact.
                val declaredLength = connection.contentLengthLong
                if (declaredLength > JSON_BODY_HARD_MAX_BYTES) {
                    throw IOException(
                        "mTLS JSON body too large ($declaredLength bytes). Use downloadMtlsFile for files."
                    )
                }

                val responseBytes = responseStream?.use { stream ->
                    readCapped(stream, JSON_BODY_HARD_MAX_BYTES)
                } ?: byteArrayOf()
                val (responseBody, isBase64) = decodeResponseBody(responseBytes)
                Log.d(TAG, "Response: status=$responseCode, bytes=${responseBytes.size}, isBase64=$isBase64")

                val responseHeaders = mutableMapOf<String, String>()
                val cookieManager = CookieManager.getInstance()
                val cookieOrigin = "${url.protocol}://${url.host}" + if (url.port != -1) ":${url.port}" else ""

                connection.headerFields?.forEach { key, values ->
                    if (key == null || values.isNullOrEmpty()) {
                        return@forEach
                    }

                    val lowerKey = key.lowercase()
                    if (lowerKey == "set-cookie") {
                        values.forEach { cookieValue ->
                            cookieManager.setCookie(cookieOrigin, cookieValue)
                        }
                        cookieManager.flush()
                        responseHeaders[lowerKey] = values.joinToString("\n")
                    } else {
                        responseHeaders[lowerKey] = values.joinToString(",")
                    }
                }

                MtlsResponse(responseCode, responseBody, responseHeaders, isBase64)
            } catch (e: Exception) {
                Log.e(TAG, "Request failed: ${e.javaClass.simpleName}: ${e.message}")
                throw Exception("Network error: ${e.message}", e)
            } finally {
                try {
                    connection.disconnect()
                } catch (e: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "SSL config error: ${e.javaClass.simpleName}: ${e.message}")
            throw e
        }
    }

    private fun streamMultipartBody(
        outputStream: java.io.OutputStream,
        boundary: String,
        fieldPairs: List<Pair<String, String>>,
        files: List<MultipartFile>
    ) {
        val crlf = "\r\n".toByteArray(Charsets.UTF_8)
        val twoHyphens = "--".toByteArray(Charsets.UTF_8)
        val boundaryBytes = boundary.toByteArray(Charsets.UTF_8)

        // Write form fields — iterate list so repeated keys (e.g. tags) are each written as a separate part
        fieldPairs.forEach { (key, value) ->
            outputStream.write(twoHyphens)
            outputStream.write(boundaryBytes)
            outputStream.write(crlf)
            outputStream.write("Content-Disposition: form-data; name=\"$key\"".toByteArray(Charsets.UTF_8))
            outputStream.write(crlf)
            outputStream.write(crlf)
            outputStream.write(value.toByteArray(Charsets.UTF_8))
            outputStream.write(crlf)
        }

        // Write files with streaming (read in chunks to avoid loading entire file into memory)
        val buffer = ByteArray(8192) // 8KB buffer
        files.forEach { file ->
            outputStream.write(twoHyphens)
            outputStream.write(boundaryBytes)
            outputStream.write(crlf)
            outputStream.write(
                "Content-Disposition: form-data; name=\"${file.fieldName}\"; filename=\"${file.fileName}\"".toByteArray(
                    Charsets.UTF_8
                )
            )
            outputStream.write(crlf)
            outputStream.write("Content-Type: ${file.mimeType}".toByteArray(Charsets.UTF_8))
            outputStream.write(crlf)
            outputStream.write(crlf)

            // Stream file content in chunks
            try {
                java.io.File(file.filePath).inputStream().use { fis ->
                    var bytesRead: Int
                    while (fis.read(buffer).also { bytesRead = it } != -1) {
                        outputStream.write(buffer, 0, bytesRead)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read file: ${file.filePath}", e)
                throw Exception("Failed to read file ${file.fileName}: ${e.message}")
            }

            outputStream.write(crlf)
        }

        // Final boundary
        outputStream.write(twoHyphens)
        outputStream.write(boundaryBytes)
        outputStream.write(twoHyphens)
        outputStream.write(crlf)
    }

    private fun buildSslConfig(): Pair<SSLSocketFactory, HostnameVerifier> {
        val (socketFactory, _) = buildSslConfigWithTrustManager()
        val hostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
        return socketFactory to hostnameVerifier
    }

    fun buildSslConfigWithTrustManager(): Pair<SSLSocketFactory, X509TrustManager> {
        cachedSocketFactory?.let { factory ->
            cachedTrustManager?.let { tm -> return factory to tm }
        }
        synchronized(sslLock) {
            cachedSocketFactory?.let { factory ->
                cachedTrustManager?.let { tm -> return factory to tm }
            }
            val built = actuallyBuildSslConfig()
            cachedSocketFactory = built.first
            cachedTrustManager = built.second
            return built
        }
    }

    private fun actuallyBuildSslConfig(): Pair<SSLSocketFactory, X509TrustManager> {
        if (!BuildConfig.MTLS_ENABLED) {
            val trustManager = buildSystemTrustManager()
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
            return sslContext.socketFactory to trustManager
        }

        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

        if (!keyStore.containsAlias(KEY_ALIAS)) {
            val error = "Private key entry not found. Please enroll first."
            Log.e(TAG, error)
            throw IllegalStateException(error)
        }
        val keyEntry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        if (keyEntry == null) {
            val error = "Failed to retrieve private key entry. Please re-enroll."
            Log.e(TAG, error)
            throw IllegalStateException(error)
        }

        if (keyEntry.certificateChain.isNullOrEmpty()) {
            val error = "Client certificate not attached to key entry. Please re-enroll to bind cert."
            Log.e(TAG, error)
            throw IllegalStateException(error)
        }

        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(keyStore, null)
        val keyManagers = kmf.keyManagers

        val trustManager = buildSystemTrustManager()

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(keyManagers, arrayOf<TrustManager>(trustManager), SecureRandom())

        return sslContext.socketFactory to trustManager
    }

    private fun buildSystemTrustManager(): X509TrustManager {
        val systemTmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
            init(null as KeyStore?)
        }
        return systemTmf.trustManagers.first { it is X509TrustManager } as X509TrustManager
    }


}
