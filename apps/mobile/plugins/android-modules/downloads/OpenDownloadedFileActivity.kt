package net.juspay.xynespaces.downloads

import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle

class OpenDownloadedFileActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = intent.getStringExtra(EXTRA_URI)?.let(Uri::parse) ?: intent.data
        val mimeType = intent.getStringExtra(EXTRA_MIME) ?: intent.type ?: "*/*"
        try {
            if (uri != null) {
                startActivity(
                    Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, mimeType)
                        clipData = ClipData.newRawUri("", uri)
                        addFlags(
                            Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    },
                )
            } else {
                openDownloads()
            }
        } catch (_: ActivityNotFoundException) {
            openDownloads()
        } catch (_: Exception) {
        } finally {
            finish()
        }
    }

    private fun openDownloads() {
        try {
            startActivity(
                Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        } catch (_: Exception) {
        }
    }

    companion object {
        const val EXTRA_URI = "fileUri"
        const val EXTRA_MIME = "mimeType"
    }
}
