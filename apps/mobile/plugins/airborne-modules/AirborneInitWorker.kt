package net.juspay.xynespaces

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

class AirborneInitWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {

    companion object {
        private const val TAG = "AirborneInitWorker"
        const val WORK_NAME = "airborne-ota-init"
    }

    override fun doWork(): Result {
        return try {
            val ctx = applicationContext
            val manager = AirborneManager.getInstance()
            Log.d(TAG, "FCM OTA trigger received, marking pending and initializing Airborne")
            manager.markOtaUpdatePending()
            manager.initialize(ctx, BuildConfig.VERSION_NAME, force = true)
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Airborne init worker failed", e)
            Result.retry()
        }
    }
}
