package net.juspay.xynespaces.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class AttachmentDownloadNotifier(private val context: Context) {
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    setSound(null, null)
                    enableVibration(false)
                    setShowBadge(false)
                },
            )
        }
    }

    fun progressNotification(job: AttachmentDownloadJob): Notification {
        val max = if (job.contentLength > 0L) 1000 else 0
        val progress = if (job.contentLength > 0L) {
            ((job.bytesWritten * 1000L) / job.contentLength).toInt().coerceIn(0, 1000)
        } else 0
        val indeterminate = job.contentLength <= 0L
        val text = if (job.contentLength > 0L) {
            "${formatSize(job.bytesWritten)} / ${formatSize(job.contentLength)}"
        } else {
            formatSize(job.bytesWritten)
        }

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(job.displayName)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(max, progress, indeterminate)
            .addAction(
                0,
                "Cancel",
                PendingIntent.getBroadcast(
                    context,
                    job.jobId.hashCode(),
                    Intent(context, AttachmentDownloadReceiver::class.java).apply {
                        action = AttachmentDownloadReceiver.ACTION_CANCEL
                        putExtra(AttachmentDownloadReceiver.EXTRA_JOB_ID, job.jobId)
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .setContentIntent(noopTapIntent())
            .build()
    }

    fun completeNotification(job: AttachmentDownloadJob, fileUri: Uri? = null, mimeType: String? = null) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Download complete")
            .setContentText(job.displayName)
            .setAutoCancel(true)
            .setContentIntent(openFileIntent(job.jobId, fileUri, mimeType ?: job.mimeType))
            .build()
        notifySafe(job.jobId.hashCode(), notification)
    }

    fun failedNotification(job: AttachmentDownloadJob, message: String) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("Download failed")
            .setContentText(message)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()
        notifySafe(job.jobId.hashCode(), notification)
    }

    fun cancel(jobId: String) {
        NotificationManagerCompat.from(context).cancel(jobId.hashCode())
    }

    private fun notifySafe(id: Int, notification: Notification) {
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
        }
    }

    private fun openFileIntent(jobId: String, fileUri: Uri?, mimeType: String): PendingIntent {
        val intent = Intent(context, OpenDownloadedFileActivity::class.java).apply {
            putExtra(OpenDownloadedFileActivity.EXTRA_MIME, mimeType.ifBlank { "*/*" })
            if (fileUri != null) {
                putExtra(OpenDownloadedFileActivity.EXTRA_URI, fileUri.toString())
                setDataAndType(fileUri, mimeType.ifBlank { "*/*" })
                clipData = ClipData.newRawUri("", fileUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }

        return PendingIntent.getActivity(
            context,
            jobId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun noopTapIntent(): PendingIntent {
        return PendingIntent.getBroadcast(
            context,
            FOREGROUND_ID,
            Intent(context, AttachmentDownloadReceiver::class.java).apply {
                action = AttachmentDownloadReceiver.ACTION_NOOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun openAppIntent(): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun formatSize(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return String.format("%.1f KB", kb)
        val mb = kb / 1024.0
        if (mb < 1024) return String.format("%.1f MB", mb)
        return String.format("%.2f GB", mb / 1024.0)
    }

    companion object {
        const val CHANNEL_ID = "attachment_downloads"
        const val FOREGROUND_ID = 9911
    }
}
