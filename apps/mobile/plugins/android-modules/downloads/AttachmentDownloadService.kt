package net.juspay.xynespaces.downloads

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import net.juspay.xynespaces.http.MtlsNetworkClient
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class AttachmentDownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val notifier by lazy { AttachmentDownloadNotifier(applicationContext) }
    private val store by lazy { AttachmentDownloadStore(applicationContext) }
    private val shuttingDown = AtomicBoolean(false)
    private val cancelledJobIds = ConcurrentHashMap.newKeySet<String>()
    private val activeJobId = AtomicReference<String?>(null)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> {
                val jobId = intent.getStringExtra(EXTRA_JOB_ID)
                if (!jobId.isNullOrBlank()) {
                    abortJob(jobId)
                }
            }
            ACTION_CLEAR -> {
                shuttingDown.set(true)
                abortAllJobs()
                stopSelf()
            }
            ACTION_START, ACTION_RESTORE, null -> {
                val requestedId = intent?.getStringExtra(EXTRA_JOB_ID)
                executor.execute { drain(requestedId) }
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        shuttingDown.set(true)
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun drain(preferredJobId: String?) {
        while (true) {
            if (shuttingDown.get()) {
                stopSelf()
                return
            }
            val job = nextJob(preferredJobId)
            if (job == null) {
                stopSelf()
                return
            }
            if (cancelledJobIds.contains(job.jobId)) {
                store.remove(job.jobId)
                continue
            }
            runJob(job)
        }
    }

    private fun nextJob(preferredJobId: String?): AttachmentDownloadJob? {
        val preferred = preferredJobId
            ?.let { store.get(it) }
            ?.takeIf { it.isActive() && !cancelledJobIds.contains(it.jobId) }
        if (preferred != null) {
            return preferred
        }
        return store.unfinished().firstOrNull { !cancelledJobIds.contains(it.jobId) }
    }

    private fun runJob(job: AttachmentDownloadJob) {
        if (cancelledJobIds.contains(job.jobId) || shuttingDown.get()) {
            deleteJobFiles(job)
            store.remove(job.jobId)
            return
        }
        val owner = AttachmentDownloadAuth.currentOwner(applicationContext)
            ?: AttachmentDownloadAuth.ownerFromHeaders(
                AttachmentDownloadAuth.headersFor(applicationContext, job.jobId),
            )
        if (!AttachmentDownloadAuth.matchesOwner(job, owner)) {
            deleteJobFiles(job)
            store.remove(job.jobId)
            AttachmentDownloadAuth.forget(job.jobId)
            return
        }
        activeJobId.set(job.jobId)
        var current = job.copy(status = AttachmentDownloadJob.STATUS_RUNNING)
        store.upsert(current)

        try {
            try {
                promoteToForeground(current)
            } catch (error: Exception) {
                throw IllegalStateException(
                    "Foreground downloads unavailable: ${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            }
            val requestHeaders = AttachmentDownloadAuth.headersFor(applicationContext, current.jobId)
            if (!AttachmentDownloadAuth.hasAuthorization(requestHeaders)) {
                throw IllegalStateException("Download requires a signed-in session")
            }

            var lastPersistedAt = 0L
            var lastPersistedBytes = current.bytesWritten
            val result = MtlsNetworkClient(applicationContext).downloadToFile(
                urlString = current.url,
                destinationPath = current.destinationPath,
                headers = requestHeaders,
                resume = true,
                cancelRequested = {
                    shuttingDown.get() ||
                        cancelledJobIds.contains(current.jobId) ||
                        activeJobId.get() != current.jobId
                },
                onProgress = { written, total ->
                    current = current.copy(bytesWritten = written, contentLength = total)
                    try {
                        promoteToForeground(current)
                    } catch (notifyError: Exception) {
                        Log.w(TAG, "Could not refresh download notification", notifyError)
                    }
                    val now = System.currentTimeMillis()
                    if (
                        now - lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS ||
                        written - lastPersistedBytes >= PROGRESS_PERSIST_BYTES
                    ) {
                        lastPersistedAt = now
                        lastPersistedBytes = written
                        store.upsert(current)
                    }
                },
            )

            if (result.statusCode !in 200..299 || result.filePath.isNullOrBlank()) {
                throw IllegalStateException(result.errorBody.ifBlank { "HTTP ${result.statusCode}" })
            }

            val saved = synchronized(COMPLETION_LOCK) {
                assertStillOwned(current.jobId)
                DownloadsModule.saveFileToDownloads(
                    applicationContext,
                    "file://${result.filePath}",
                    current.displayName,
                    current.mimeType,
                )
            }
            deleteStagingFiles(result.filePath)
            current = current.copy(
                status = AttachmentDownloadJob.STATUS_COMPLETED,
                bytesWritten = result.byteCount,
            )
            store.remove(current.jobId)
            AttachmentDownloadAuth.forget(current.jobId)
            try {
                notifier.completeNotification(
                    current.copy(displayName = saved.displayName),
                    saved.uri,
                    saved.mimeType,
                )
            } catch (notifyError: Exception) {
                Log.e(TAG, "Failed to show complete notification", notifyError)
            }
        } catch (error: Exception) {
            val cancelledJob = error.message == "Download cancelled"
            current = current.copy(
                status = if (cancelledJob) AttachmentDownloadJob.STATUS_CANCELLED else AttachmentDownloadJob.STATUS_FAILED,
                error = error.message,
            )
            if (cancelledJob) {
                store.remove(current.jobId)
                AttachmentDownloadAuth.forget(current.jobId)
                notifier.cancel(current.jobId)
            } else {
                store.upsert(current)
                notifier.failedNotification(current, error.message ?: "Download failed")
            }
        } finally {
            activeJobId.set(null)
        }
    }

    private fun abortJob(jobId: String) {
        synchronized(COMPLETION_LOCK) {
            cancelledJobIds.add(jobId)
            val job = store.get(jobId)
            AttachmentDownloadAuth.forget(jobId)
            store.remove(jobId)
            notifier.cancel(jobId)
            deleteJobFiles(job)
        }
    }

    private fun abortAllJobs() {
        synchronized(COMPLETION_LOCK) {
            val jobs = store.all().values.toList()
            cancelledJobIds.addAll(jobs.map { it.jobId })
            AttachmentDownloadAuth.forgetAll()
            store.clear()
            jobs.forEach { job ->
                notifier.cancel(job.jobId)
                deleteJobFiles(job)
            }
        }
    }

    private fun assertStillOwned(jobId: String) {
        if (
            shuttingDown.get() ||
            cancelledJobIds.contains(jobId) ||
            activeJobId.get() != jobId
        ) {
            throw IOException("Download cancelled")
        }
        val headers = AttachmentDownloadAuth.headersFor(applicationContext, jobId)
        if (!AttachmentDownloadAuth.hasAuthorization(headers)) {
            throw IOException("Download cancelled")
        }
        val job = store.get(jobId)
        val owner = AttachmentDownloadAuth.ownerFromHeaders(headers)
            ?: AttachmentDownloadAuth.currentOwner(applicationContext)
        if (job == null || !AttachmentDownloadAuth.matchesOwner(job, owner)) {
            throw IOException("Download cancelled")
        }
    }

    private fun deleteJobFiles(job: AttachmentDownloadJob?) {
        deleteStagingFiles(job?.destinationPath)
    }

    private fun deleteStagingFiles(path: String?) {
        if (path.isNullOrBlank()) return
        val staging = File(path.removePrefix("file://"))
        if (staging.exists() && !staging.delete()) {
            Log.w(TAG, "Failed to delete staging file: ${staging.absolutePath}")
        }
        File("${staging.absolutePath}.part").delete()
        File("${staging.absolutePath}.part.meta").delete()
    }

    private fun promoteToForeground(job: AttachmentDownloadJob) {
        ServiceCompat.startForeground(
            this,
            AttachmentDownloadNotifier.FOREGROUND_ID,
            notifier.progressNotification(job),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
    }

    companion object {
        const val ACTION_START = "net.juspay.xynespaces.downloads.START"
        const val ACTION_RESTORE = "net.juspay.xynespaces.downloads.RESTORE"
        const val ACTION_CANCEL = "net.juspay.xynespaces.downloads.CANCEL"
        const val ACTION_CLEAR = "net.juspay.xynespaces.downloads.CLEAR"
        const val EXTRA_JOB_ID = "jobId"
        private const val TAG = "AttachmentDownload"
        private const val PROGRESS_PERSIST_INTERVAL_MS = 2_000L
        private const val PROGRESS_PERSIST_BYTES = 2L * 1024L * 1024L
        private val COMPLETION_LOCK = Any()

        fun rollbackUnstartedJob(context: Context, job: AttachmentDownloadJob) {
            AttachmentDownloadAuth.forget(job.jobId)
            AttachmentDownloadStore(context).remove(job.jobId)
            deleteStagingFilesStatic(job.destinationPath)
        }

        fun start(context: Context, jobId: String? = null) {
            val intent = Intent(context, AttachmentDownloadService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_JOB_ID, jobId)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun restore(context: Context) {
            val store = AttachmentDownloadStore(context)
            val unfinished = store.unfinished().filter { job ->
                val owner = AttachmentDownloadAuth.currentOwner(context)
                    ?: AttachmentDownloadAuth.ownerFromHeaders(
                        AttachmentDownloadAuth.headersFor(context, job.jobId),
                    )
                if (AttachmentDownloadAuth.matchesOwner(job, owner)) {
                    true
                } else {
                    deleteStagingFilesStatic(job.destinationPath)
                    store.remove(job.jobId)
                    AttachmentDownloadAuth.forget(job.jobId)
                    false
                }
            }
            if (unfinished.isEmpty()) return
            val probeHeaders = AttachmentDownloadAuth.headersFor(context, unfinished.first().jobId)
            if (!AttachmentDownloadAuth.hasAuthorization(probeHeaders)) {
                Log.w(TAG, "Skipping restore until a signed-in session is available")
                return
            }
            val intent = Intent(context, AttachmentDownloadService::class.java).apply {
                action = ACTION_RESTORE
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (error: Exception) {
                Log.w(TAG, "Could not restore downloads until next foreground launch: ${error.message}")
            }
        }

        fun cancel(context: Context, jobId: String) {
            context.startService(
                Intent(context, AttachmentDownloadService::class.java).apply {
                    action = ACTION_CANCEL
                    putExtra(EXTRA_JOB_ID, jobId)
                },
            )
        }

        fun clearAll(context: Context) {
            synchronized(COMPLETION_LOCK) {
                val store = AttachmentDownloadStore(context)
                val jobs = store.all().values.toList()
                AttachmentDownloadAuth.forgetAll()
                jobs.forEach { deleteStagingFilesStatic(it.destinationPath) }
                store.clear()
            }
            try {
                context.startService(
                    Intent(context, AttachmentDownloadService::class.java).apply {
                        action = ACTION_CLEAR
                    },
                )
            } catch (error: Exception) {
                Log.w(TAG, "Could not stop download service during clear: ${error.message}")
            }
        }

        private fun deleteStagingFilesStatic(path: String?) {
            if (path.isNullOrBlank()) return
            val staging = File(path.removePrefix("file://"))
            staging.delete()
            File("${staging.absolutePath}.part").delete()
            File("${staging.absolutePath}.part.meta").delete()
        }
    }
}
