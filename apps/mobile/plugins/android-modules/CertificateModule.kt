package net.juspay.xynespaces.certificate

import net.juspay.xynespaces.http.MtlsTransportPolicy
import com.facebook.react.bridge.*
import net.juspay.xynespaces.http.MtlsFileDownloadResult
import net.juspay.xynespaces.http.MtlsNetworkClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.FutureTask
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Data classes for parsing FormData payload from JSON
 */
data class FormDataPayload(
    val formData: Boolean,
    val fields: List<FormDataField>,
    val files: List<FormDataFile>
)

data class FormDataField(
    val name: String,
    val value: String
)

data class FormDataFile(
    val name: String,
    val type: String,
    val uri: String,
    val fieldName: String
)

/**
 * Parse JSON string to FormDataPayload
 */
fun parseFormDataPayload(jsonString: String): FormDataPayload? {
    return try {
        val trimmedJson = jsonString.trim()
        if (!trimmedJson.startsWith("{")) return null

        val rootJson = JSONObject(trimmedJson)
        val json = when {
            rootJson.has("jsonBody") -> {
                when (val wrappedBody = rootJson.get("jsonBody")) {
                    is JSONObject -> wrappedBody
                    is String -> JSONObject(wrappedBody)
                    else -> return null
                }
            }
            rootJson.optBoolean("formData", false) -> rootJson
            else -> return null
        }

        val formData = json.getBoolean("formData")

        val fieldsArray = json.getJSONArray("fields")
        val fields = mutableListOf<FormDataField>()
        for (i in 0 until fieldsArray.length()) {
            val fieldObj = fieldsArray.getJSONObject(i)
            fields.add(FormDataField(
                name = fieldObj.getString("name"),
                value = fieldObj.getString("value")
            ))
        }

        val filesArray = json.getJSONArray("files")
        val files = mutableListOf<FormDataFile>()
        for (i in 0 until filesArray.length()) {
            val fileObj = filesArray.getJSONObject(i)
            files.add(FormDataFile(
                name = fileObj.getString("name"),
                type = fileObj.getString("type"),
                uri = fileObj.getString("uri"),
                fieldName = fileObj.getString("fieldName")
            ))
        }

        FormDataPayload(formData, fields, files)
    } catch (e: Exception) {
        android.util.Log.e("CertificateModule", "Failed to parse FormData payload", e)
        null
    }
}

class CertificateModule(
    reactContext: ReactApplicationContext,
    private val certificateManager: CertificateManager
) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        // File transfers, in both directions. Four, so a chat scroll of thumbnails
        // does not wait behind one video.
        private val downloadExecutor = Executors.newFixedThreadPool(4)

        // org.json builds a HashMap tree AND substring-copies every string field.
        // Above this size, send a String and let JS JSON.parse ONCE.
        const val JSON_STRUCTURED_BRIDGE_MAX_BYTES = 256 * 1024

        private const val REQUEST_QUEUE_CAPACITY = 64

        /**
         * A raw `Thread {}` per request meant search could spawn a dozen threads a
         * second under fast typing, each with its own stack, with nothing bounding
         * concurrency. A pool bounds that.
         *
         * Core and maximum are deliberately the same number. ThreadPoolExecutor only
         * grows past the core size once the queue refuses a task, so paired with a
         * queue that accepts everything a `2, 6` pool is really a two-thread pool and
         * the maximum never comes into play. Setting core equal to max gives the six
         * threads of real parallelism the radio can service, and
         * allowCoreThreadTimeOut still lets them retire once the user stops typing.
         *
         * The queue is bounded for the same reason the threads are: superseded
         * requests must not pile up without a ceiling. When it does fill, submit
         * throws and the caller is told, which is handled at the submit site.
         */
        private val requestExecutor: ThreadPoolExecutor = ThreadPoolExecutor(
            6,
            6,
            30L,
            TimeUnit.SECONDS,
            LinkedBlockingQueue(REQUEST_QUEUE_CAPACITY)
        ) { runnable -> Thread(runnable, "mtls-request").apply { isDaemon = true } }
            .apply { allowCoreThreadTimeOut(true) }

        /** requestId -> in-flight work, so JS can abort a superseded request. */
        private val inFlight = ConcurrentHashMap<String, Future<*>>()

        /** Cancels that arrived before their future was registered. */
        private val cancelledRequestIds: MutableSet<String> =
            Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())

        /**
         * Aborts everything still running against the current client identity. A
         * request that started before the identity changed can only finish with the
         * old certificate, so it is dropped rather than left to race the new one.
         */
        private fun tearDownSharedSession() {
            inFlight.values.forEach { future ->
                future.cancel(true)
                // Cancelling alone leaves a not-yet-started task sitting in the queue,
                // still holding its headers, body and promise until a worker polls it;
                // evicting it releases that now.
                val queued = future as? Runnable
                if (queued != null) requestExecutor.remove(queued)
            }
            inFlight.clear()
            cancelledRequestIds.clear()
        }
    }

    override fun getName(): String = "CertificateModule"

    @ReactMethod
    fun isEnrolled(promise: Promise) {
        try {
            promise.resolve(certificateManager.isEnrolled(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("ENROLLMENT_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hasPrivateKey(promise: Promise) {
        try {
            promise.resolve(certificateManager.hasPrivateKey())
        } catch (e: Exception) {
            promise.reject("CHECK_PRIVATE_KEY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun generateCSR(promise: Promise) {
        try {
            // A new keypair invalidates the identity any in-flight request is using,
            // so nothing may outlive the key it was started with.
            tearDownSharedSession()

            val deviceInfo = certificateManager.getDeviceInfo()
            val (csr, _) = certificateManager.generateCSR(reactApplicationContext, deviceInfo)
            // The cached SSL context was built around the key this just replaced.
            MtlsNetworkClient.clearSslCache()

            val result = Arguments.createMap().apply {
                putString("csr", csr)
                putMap("deviceInfo", mapToWritableMap(deviceInfo))
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CSR_GENERATION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun storeCertificate(certificatePem: String, caChainPem: String?, promise: Promise) {
        try {
            val success = certificateManager.storeCertificate(reactApplicationContext, certificatePem, caChainPem)
            if (success) {
                // The cached SSL context was built around the certificate just replaced.
                MtlsNetworkClient.clearSslCache()

                // Anything started against the previous certificate is now stale, so it
                // is dropped instead of being allowed to finish with the old identity.
                tearDownSharedSession()

                promise.resolve(true)
            } else {
                promise.reject("CERTIFICATE_STORAGE_ERROR", "Failed to store certificate")
            }
        } catch (e: Exception) {
            promise.reject("CERTIFICATE_STORAGE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getCertificate(promise: Promise) {
        try {
            val certPem = certificateManager.getCertificate()
            if (certPem != null) {
                promise.resolve(certPem)
            } else {
                promise.reject("NO_CERTIFICATE", "No certificate found")
            }
        } catch (e: Exception) {
            promise.reject("GET_CERTIFICATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearCertificates(promise: Promise) {
        try {
            val success = certificateManager.clearCertificates(reactApplicationContext)
            MtlsNetworkClient.clearSslCache()

            // Logout: these requests authenticate with an identity that is now gone.
            // After the delete and the cache drop, not before — a request landing in
            // that window would otherwise pick up the identity being deleted, and
            // would not be covered by this cancellation.
            tearDownSharedSession()

            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("CLEAR_CERTIFICATES_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun performMtlsRequest(
        url: String,
        requestId: String?,
        method: String?,
        headers: ReadableMap?,
        body: Dynamic?,
        promise: Promise
    ) {
        if (!MtlsTransportPolicy.isApprovedHttpUrl(url)) {
            if (requestId != null) cancelledRequestIds.remove(requestId)
            promise.reject("UNAPPROVED_DESTINATION", "HTTP destination is not approved")
            return
        }
        if (requestId != null && cancelledRequestIds.remove(requestId)) {
            promise.reject("MTLS_CANCELLED", "Request was cancelled")
            return
        }

        // The task is built but NOT handed to the pool yet. `submit` can hand the
        // runnable to an idle worker before the calling thread gets to register it,
        // which loses cancels two ways: a cancel landing in that gap finds nothing in
        // the map and only leaves a tombstone the already-running worker will never
        // look at, and a worker that finishes first removes an entry that has not been
        // inserted, so the completed future is then registered and never cleaned up.
        // Registering before execution removes the gap entirely.
        val task = FutureTask(
            Runnable {
                try {
                    if (Thread.currentThread().isInterrupted) {
                        promise.reject("MTLS_CANCELLED", "Request was cancelled")
                        return@Runnable
                    }
                    val headerMap = readableMapToStringMap(headers)
                    val normalizedMethod = (method ?: "GET").uppercase()

                    // Handle body - can be String (plain JSON/text) or Map (FormData)
                    when {
                        // FormData payload passed as JSON string with jsonBody key
                        body != null && body.type == ReadableType.Map && body.asMap()?.hasKey("jsonBody") == true -> {
                            val bodyMap = body.asMap()!!
                            val jsonBodyString = bodyMap.getString("jsonBody")
                            android.util.Log.d("CertificateModule", "Received jsonBody string length: ${jsonBodyString?.length ?: 0}")

                            // Parse the JSON to get the FormDataPayload
                            val formDataPayload = jsonBodyString?.let { parseFormDataPayload(it) }

                            if (formDataPayload == null) {
                                android.util.Log.e("CertificateModule", "Failed to parse jsonBody")
                                promise.reject("PARSE_ERROR", "Failed to parse FormData payload")
                                return@Runnable
                            }

                            android.util.Log.d("CertificateModule", "Parsed formDataPayload fields count: ${formDataPayload.fields.size}")
                            android.util.Log.d("CertificateModule", "Parsed formDataPayload files count: ${formDataPayload.files.size}")

                            // Preserve fields as ordered list so repeated keys (e.g. multiple `tags`) are kept
                            val fieldPairs = formDataPayload.fields.map { it.name to it.value }

                            // Convert files list to MultipartFile list
                            val fileList = formDataPayload.files.map {
                                net.juspay.xynespaces.http.MultipartFile(
                                    fieldName = it.fieldName,
                                    filePath = it.uri.removePrefix("file://"),
                                    fileName = it.name,
                                    mimeType = it.type
                                )
                            }.toMutableList()

                            android.util.Log.d("CertificateModule", "Final FormData fieldPairs count: ${fieldPairs.size}")
                            android.util.Log.d("CertificateModule", "Final FormData files count: ${fileList.size}")

                            val response = MtlsNetworkClient(reactApplicationContext).makeMtlsMultipartUpload(
                                url, fieldPairs, fileList, headerMap
                            )

                            promise.resolve(buildResult(response))
                        }
                        // Wrapped string body { stringBody: "..." }
                        body != null && body.type == ReadableType.Map && body.asMap()?.hasKey("stringBody") == true -> {
                            val bodyString = body.asMap()!!.getString("stringBody")
                            val response = MtlsNetworkClient(reactApplicationContext).makeMtlsRequest(
                                url, normalizedMethod, headerMap, bodyString
                            )
                            promise.resolve(buildResult(response))
                        }
                        // Plain string body (direct JSON/text)
                        body != null && body.type == ReadableType.String -> {
                            val bodyString = body.asString() ?: ""
                            val formDataPayload = parseFormDataPayload(bodyString)

                            val response = if (formDataPayload != null && formDataPayload.formData) {
                                android.util.Log.d("CertificateModule", "Parsed FormData from string body fields count: ${formDataPayload.fields.size}")
                                android.util.Log.d("CertificateModule", "Parsed FormData from string body files count: ${formDataPayload.files.size}")

                                // Preserve fields as ordered list so repeated keys (e.g. multiple `tags`) are kept
                                val fieldPairs = formDataPayload.fields.map { it.name to it.value }

                                val fileList = formDataPayload.files.map {
                                    net.juspay.xynespaces.http.MultipartFile(
                                        fieldName = it.fieldName,
                                        filePath = it.uri.removePrefix("file://"),
                                        fileName = it.name,
                                        mimeType = it.type
                                    )
                                }.toMutableList()

                                android.util.Log.d("CertificateModule", "Final FormData fieldPairs count: ${fieldPairs.size}")
                                android.util.Log.d("CertificateModule", "Final FormData files count: ${fileList.size}")

                                MtlsNetworkClient(reactApplicationContext).makeMtlsMultipartUpload(
                                    url, fieldPairs, fileList, headerMap
                                )
                            } else {
                                MtlsNetworkClient(reactApplicationContext).makeMtlsRequest(
                                    url, normalizedMethod, headerMap, bodyString
                                )
                            }

                            promise.resolve(buildResult(response))
                        }
                        // No body or unsupported type
                        else -> {
                            val response = MtlsNetworkClient(reactApplicationContext).makeMtlsRequest(
                                url, normalizedMethod, headerMap, null
                            )
                            promise.resolve(buildResult(response))
                        }
                    }
                } catch (e: InterruptedException) {
                    promise.reject("MTLS_CANCELLED", "Request was cancelled", e)
                } catch (e: Exception) {
                    promise.reject("MTLS_REQUEST_ERROR", e.message, e)
                } finally {
                    if (requestId != null) inFlight.remove(requestId)
                }
            },
            Unit
        )

        if (requestId != null) {
            inFlight[requestId] = task
            // A cancel that arrived while we were registering saw no entry and left a
            // tombstone instead. Consuming it here is what closes that window: either
            // the cancel found the task and cancelled it, or it left this flag and we
            // stand the request down ourselves.
            if (cancelledRequestIds.remove(requestId)) {
                inFlight.remove(requestId, task)
                promise.reject("MTLS_CANCELLED", "Request was cancelled")
                return
            }
        }

        // When the queue is full and every thread is busy the pool aborts the submit.
        // Telling JS so is better than letting the backlog grow: a caller that gets an
        // error can back off, whereas an unbounded queue would just defer the work and
        // a promise that never settles would strand the screen.
        try {
            requestExecutor.execute(task)
        } catch (e: RejectedExecutionException) {
            if (requestId != null) inFlight.remove(requestId, task)
            promise.reject("MTLS_BUSY", "Too many in-flight mTLS requests", e)
            return
        }
    }

    /** Aborts one in-flight request. Safe for an id that already finished. */
    @ReactMethod
    fun cancelMtlsRequest(requestId: String, promise: Promise) {
        val future = inFlight.remove(requestId)
        if (future == null) {
            // The cancel raced ahead of submit — remember it so the request never starts.
            cancelledRequestIds.add(requestId)
            promise.resolve(false)
            return
        }
        future.cancel(true)
        // A cancelled task that never started still occupies its queue slot, and the
        // request's headers, body and promise with it, until a worker gets around to
        // discarding it. Removing it hands that back immediately.
        val queued = future as? Runnable
        if (queued != null) requestExecutor.remove(queued)
        promise.resolve(true)
    }

    /**
     * Explicit escape hatch for JS, and the counterpart to the iOS method of the same
     * name. The three methods that change the stored identity already call
     * tearDownSharedSession themselves, so callers do not have to remember to.
     *
     * Android builds a connection per request via MtlsNetworkClient, so there is no
     * shared session here — what this drops is in-flight work started under the
     * previous identity.
     */
    @ReactMethod
    fun invalidateMtlsSession(promise: Promise) {
        tearDownSharedSession()
        promise.resolve(null)
    }

    /**
     * Perform mTLS multipart/form-data upload for file attachments.
     *
     * @param url The upload endpoint URL
     * @param fields ReadableMap of form field names to values
     * @param files ReadableArray of file objects with: fieldName, filePath, fileName, mimeType
     * @param headers ReadableMap of additional HTTP headers
     */
    @ReactMethod
    fun performMtlsMultipartUpload(
        url: String,
        fields: ReadableMap?,
        files: ReadableArray?,
        headers: ReadableMap?,
        promise: Promise
    ) {
        // Bounded like every other transfer, but on the file pool: an upload can run
        // for minutes, and on the request pool it would hold up API calls.
        downloadExecutor.execute {
            try {
                if (!MtlsTransportPolicy.isApprovedHttpUrl(url)) {
                    promise.reject("UNAPPROVED_DESTINATION", "HTTP destination is not approved")
                    return@execute
                }
                val fieldMap = readableMapToStringMap(fields)
                val headerMap = readableMapToStringMap(headers)

                // Parse files array
                val fileList = mutableListOf<net.juspay.xynespaces.http.MultipartFile>()
                files?.let {
                    for (i in 0 until it.size()) {
                        val fileMap = it.getMap(i)
                        if (fileMap != null) {
                            fileList.add(
                                net.juspay.xynespaces.http.MultipartFile(
                                    fieldName = fileMap.getString("fieldName") ?: "files",
                                    filePath = fileMap.getString("filePath") ?: "",
                                    fileName = fileMap.getString("fileName") ?: "",
                                    mimeType = fileMap.getString("mimeType") ?: "application/octet-stream"
                                )
                            )
                        }
                    }
                }

                val response = MtlsNetworkClient(reactApplicationContext).makeMtlsMultipartUpload(
                    url, fieldMap, fileList, headerMap
                )

                promise.resolve(buildResult(response))
            } catch (e: Exception) {
                promise.reject("MTLS_UPLOAD_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun downloadMtlsFile(
        url: String,
        destinationPath: String,
        headers: ReadableMap?,
        promise: Promise,
    ) {
        downloadExecutor.execute {
            try {
                if (!MtlsTransportPolicy.isApprovedHttpUrl(url)) {
                    throw SecurityException("Download destination is not approved")
                }
                val result = MtlsNetworkClient(reactApplicationContext).downloadToFile(
                    url,
                    destinationPath,
                    readableMapToStringMap(headers),
                )
                promise.resolve(buildDownloadResult(result))
            } catch (error: Exception) {
                promise.reject("MTLS_DOWNLOAD_ERROR", error.message, error)
            }
        }
    }

    private fun readableMapToStringMap(readableMap: ReadableMap?): Map<String, String> {
        if (readableMap == null) return emptyMap()
        val out = mutableMapOf<String, String>()
        val hashMap = readableMap.toHashMap()
        for ((key, value) in hashMap) {
            out[key] = value?.toString() ?: ""
        }
        return out
    }

    private fun mapToWritableMap(map: Map<String, String>): WritableMap {
        val writable = Arguments.createMap()
        map.forEach { (k, v) -> writable.putString(k, v) }
        return writable
    }

    private fun jsonObjectToWritableMap(obj: JSONObject): WritableMap {
        val map = Arguments.createMap()
        obj.keys().forEach { key ->
            when (val value = obj.get(key)) {
                is JSONObject -> map.putMap(key, jsonObjectToWritableMap(value))
                is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
                is Boolean -> map.putBoolean(key, value)
                is Int -> map.putInt(key, value)
                is Long -> map.putDouble(key, value.toDouble())
                is Double -> map.putDouble(key, value)
                is String -> map.putString(key, value)
                JSONObject.NULL -> map.putNull(key)
                else -> map.putString(key, value.toString())
            }
        }
        return map
    }

    private fun jsonArrayToWritableArray(arr: JSONArray): WritableArray {
        val array = Arguments.createArray()
        for (i in 0 until arr.length()) {
            when (val value = arr.get(i)) {
                is JSONObject -> array.pushMap(jsonObjectToWritableMap(value))
                is JSONArray -> array.pushArray(jsonArrayToWritableArray(value))
                is Boolean -> array.pushBoolean(value)
                is Int -> array.pushInt(value)
                is Long -> array.pushDouble(value.toDouble())
                is Double -> array.pushDouble(value)
                is String -> array.pushString(value)
                JSONObject.NULL -> array.pushNull()
                else -> array.pushString(value.toString())
            }
        }
        return array
    }

    private fun buildResult(response: net.juspay.xynespaces.http.MtlsResponse): WritableMap {
        val result = Arguments.createMap()
        result.putInt("status", response.statusCode)
        result.putBoolean("ok", response.statusCode in 200..299)
        result.putMap("headers", mapToWritableMap(response.headers))
        result.putBoolean("isBase64", response.isBase64)

        if (response.isBase64) {
            // Binary must NOT reach here anymore. If it does, it is a bug:
            // some caller still used performMtlsRequest for a file.
            result.putString("body", response.body)
            return result
        }

        val trimmed = response.body.trimStart()
        val tooLargeForTree = response.body.length * 2 > JSON_STRUCTURED_BRIDGE_MAX_BYTES

        if (tooLargeForTree) {
            // Crashlytics died in JSONObject(response.body) at buildResult.
            // Skipping the tree is the direct fix for that stack.
            result.putString("body", response.body)
            return result
        }

        try {
            when {
                trimmed.startsWith('{') ->
                    result.putMap("body", jsonObjectToWritableMap(JSONObject(response.body)))
                trimmed.startsWith('[') ->
                    result.putArray("body", jsonArrayToWritableArray(JSONArray(response.body)))
                else -> result.putString("body", response.body)
            }
        } catch (_: Exception) {
            result.putString("body", response.body)
        }
        return result
    }

    private fun buildDownloadResult(result: MtlsFileDownloadResult): WritableMap {
        val map = Arguments.createMap()
        map.putInt("status", result.statusCode)
        map.putBoolean("ok", result.statusCode in 200..299 && !result.filePath.isNullOrBlank())
        map.putString(
            "uri",
            result.filePath?.let { path ->
                if (path.startsWith("file:")) path else "file://$path"
            },
        )
        map.putDouble("size", result.byteCount.toDouble())
        map.putString("mimeType", result.mimeType)
        map.putString("errorBody", result.errorBody)
        map.putMap("headers", mapToWritableMap(result.headers))
        return map
    }
}
