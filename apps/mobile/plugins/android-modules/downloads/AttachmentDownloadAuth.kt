package net.juspay.xynespaces.downloads

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import net.juspay.xynespaces.AuthContextStore
import java.util.concurrent.ConcurrentHashMap

data class DownloadOwner(
    val userId: String,
    val workspaceId: String,
)

/**
 * Auth for downloads is never written to the job store.
 * Live headers stay in memory for this process; after a kill we read the
 * current signed-in token from the protected AuthContextStore.
 */
object AttachmentDownloadAuth {
    private val liveHeaders = ConcurrentHashMap<String, Map<String, String>>()

    fun remember(jobId: String, headers: Map<String, String>) {
        if (headers.isNotEmpty()) {
            liveHeaders[jobId] = headers.toMap()
        }
    }

    fun forget(jobId: String) {
        liveHeaders.remove(jobId)
    }

    fun forgetAll() {
        liveHeaders.clear()
    }

    fun headersFor(context: Context, jobId: String): Map<String, String> {
        liveHeaders[jobId]?.takeIf { it.isNotEmpty() }?.let { return it }

        val token = currentToken(context)
        if (token.isEmpty()) {
            return emptyMap()
        }
        return mapOf("Authorization" to "Bearer $token")
    }

    fun hasAuthorization(headers: Map<String, String>): Boolean {
        val value = headers.entries.firstOrNull { it.key.equals("Authorization", ignoreCase = true) }?.value
        return !value.isNullOrBlank()
    }

    fun currentOwner(context: Context): DownloadOwner? = ownerFromToken(currentToken(context))

    fun ownerFromHeaders(headers: Map<String, String>): DownloadOwner? {
        val token = headers.entries
            .firstOrNull { it.key.equals("Authorization", ignoreCase = true) }
            ?.value
            ?.removePrefix("Bearer ")
            ?.trim()
            .orEmpty()
        return ownerFromToken(token)
    }

    fun matchesOwner(job: AttachmentDownloadJob, owner: DownloadOwner?): Boolean {
        if (owner == null) return false
        if (job.ownerUserId.isBlank() || job.ownerWorkspaceId.isBlank()) return false
        return job.ownerUserId == owner.userId && job.ownerWorkspaceId == owner.workspaceId
    }

    private fun currentToken(context: Context): String =
        AuthContextStore.read(context.applicationContext)?.token?.trim().orEmpty()

    private fun ownerFromToken(token: String): DownloadOwner? {
        val raw = token.removePrefix("Bearer ").trim()
        if (raw.isEmpty()) return null
        val parts = raw.split('.')
        if (parts.size < 2) return null
        return try {
            val payload = String(
                Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
                Charsets.UTF_8,
            )
            val claims = JSONObject(payload)
            val userId = claims.optString("sub").trim()
            val workspaceId = claims.optString("workspaceId").trim()
            if (userId.isEmpty() || workspaceId.isEmpty()) null else DownloadOwner(userId, workspaceId)
        } catch (_: Exception) {
            null
        }
    }

}
