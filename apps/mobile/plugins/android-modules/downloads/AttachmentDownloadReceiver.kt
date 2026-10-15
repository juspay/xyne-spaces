package net.juspay.xynespaces.downloads

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class AttachmentDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_NOOP -> return
            ACTION_CANCEL -> {
                val jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: return
                AttachmentDownloadService.cancel(context, jobId)
            }
        }
    }

    companion object {
        const val ACTION_CANCEL = "net.juspay.xynespaces.downloads.NOTIFICATION_CANCEL"
        const val ACTION_NOOP = "net.juspay.xynespaces.downloads.NOTIFICATION_NOOP"
        const val EXTRA_JOB_ID = "jobId"
    }
}
