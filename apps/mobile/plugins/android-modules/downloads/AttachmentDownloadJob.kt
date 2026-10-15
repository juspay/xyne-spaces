package net.juspay.xynespaces.downloads

import org.json.JSONObject

data class AttachmentDownloadJob(
    val jobId: String,
    val attachmentId: String,
    val url: String,
    val destinationPath: String,
    val displayName: String,
    val mimeType: String,
    val ownerUserId: String = "",
    val ownerWorkspaceId: String = "",
    val bytesWritten: Long = 0L,
    val contentLength: Long = -1L,
    val status: String = STATUS_QUEUED,
    val error: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("jobId", jobId)
        put("attachmentId", attachmentId)
        put("url", url)
        put("destinationPath", destinationPath)
        put("displayName", displayName)
        put("mimeType", mimeType)
        put("ownerUserId", ownerUserId)
        put("ownerWorkspaceId", ownerWorkspaceId)
        put("bytesWritten", bytesWritten)
        put("contentLength", contentLength)
        put("status", status)
        put("error", error ?: JSONObject.NULL)
    }

    companion object {
        const val STATUS_QUEUED = "queued"
        const val STATUS_RUNNING = "running"
        const val STATUS_COMPLETED = "completed"
        const val STATUS_FAILED = "failed"
        const val STATUS_CANCELLED = "cancelled"

        fun fromJson(obj: JSONObject): AttachmentDownloadJob {
            return AttachmentDownloadJob(
                jobId = obj.getString("jobId"),
                attachmentId = obj.getString("attachmentId"),
                url = obj.getString("url"),
                destinationPath = obj.getString("destinationPath"),
                displayName = obj.getString("displayName"),
                mimeType = obj.optString("mimeType", "application/octet-stream"),
                ownerUserId = obj.optString("ownerUserId"),
                ownerWorkspaceId = obj.optString("ownerWorkspaceId"),
                bytesWritten = obj.optLong("bytesWritten", 0L),
                contentLength = obj.optLong("contentLength", -1L),
                status = obj.optString("status", STATUS_QUEUED),
                error = if (obj.isNull("error")) null else obj.optString("error"),
            )
        }
    }
}

fun AttachmentDownloadJob.isActive(): Boolean =
    status == AttachmentDownloadJob.STATUS_QUEUED || status == AttachmentDownloadJob.STATUS_RUNNING
