package net.juspay.xynespaces.downloads

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import net.juspay.xynespaces.http.MtlsNetworkClient
import java.util.UUID

class AttachmentDownloadModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun startDownload(options: ReadableMap, promise: Promise) {
        try {
            val store = AttachmentDownloadStore(reactContext)
            val attachmentId = options.getString("attachmentId")
                ?: throw IllegalArgumentException("attachmentId required")
            val headers = mutableMapOf<String, String>()
            options.getMap("headers")?.toHashMap()?.forEach { (k, v) ->
                headers[k] = v?.toString() ?: ""
            }

            val existing = store.unfinished().firstOrNull { it.attachmentId == attachmentId }
            if (existing != null) {
                MtlsNetworkClient.assertApprovedDownloadUrl(reactContext, existing.url)
                val owner = AttachmentDownloadAuth.ownerFromHeaders(headers)
                    ?: AttachmentDownloadAuth.currentOwner(reactContext)
                if (!AttachmentDownloadAuth.matchesOwner(existing, owner)) {
                    throw IllegalStateException("Download belongs to a different workspace session")
                }
                AttachmentDownloadAuth.remember(existing.jobId, headers)
                AttachmentDownloadService.start(reactContext, existing.jobId)
                promise.resolve(jobMap(existing))
                return
            }

            val url = options.getString("url") ?: throw IllegalArgumentException("url required")
            MtlsNetworkClient.assertApprovedDownloadUrl(reactContext, url)
            val owner = AttachmentDownloadAuth.ownerFromHeaders(headers)
                ?: AttachmentDownloadAuth.currentOwner(reactContext)
                ?: throw IllegalStateException("Download requires a signed-in session")

            val job = AttachmentDownloadJob(
                jobId = UUID.randomUUID().toString(),
                attachmentId = attachmentId,
                url = url,
                destinationPath = options.getString("destinationPath")
                    ?: throw IllegalArgumentException("destinationPath required"),
                displayName = options.getString("displayName") ?: "attachment",
                mimeType = options.getString("mimeType") ?: "application/octet-stream",
                ownerUserId = owner.userId,
                ownerWorkspaceId = owner.workspaceId,
            )
            store.upsert(job)
            AttachmentDownloadAuth.remember(job.jobId, headers)
            try {
                AttachmentDownloadService.start(reactContext, job.jobId)
            } catch (error: Exception) {
                AttachmentDownloadService.rollbackUnstartedJob(reactContext, job)
                throw error
            }
            promise.resolve(jobMap(job))
        } catch (error: Exception) {
            promise.reject("DOWNLOAD_START_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun cancelDownload(jobId: String, promise: Promise) {
        AttachmentDownloadService.cancel(reactContext, jobId)
        promise.resolve(true)
    }

    @ReactMethod
    fun restoreDownloads(promise: Promise) {
        AttachmentDownloadService.restore(reactContext)
        promise.resolve(true)
    }

    @ReactMethod
    fun clearDownloads(promise: Promise) {
        AttachmentDownloadService.clearAll(reactContext)
        promise.resolve(true)
    }

    companion object {
        const val NAME = "LotusAttachmentDownloads"

        private fun jobMap(job: AttachmentDownloadJob): WritableMap =
            Arguments.createMap().apply {
                putString("jobId", job.jobId)
                putString("attachmentId", job.attachmentId)
                putString("status", job.status)
            }
    }
}
