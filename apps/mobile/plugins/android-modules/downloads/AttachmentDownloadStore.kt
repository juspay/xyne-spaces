package net.juspay.xynespaces.downloads

import android.content.Context
import org.json.JSONArray

class AttachmentDownloadStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    init {
        synchronized(LOCK) {
            persist(readAllLocked())
        }
    }

    fun upsert(job: AttachmentDownloadJob) = synchronized(LOCK) {
        val jobs = readAllLocked().toMutableMap()
        jobs[job.jobId] = job
        persist(jobs)
    }

    fun get(jobId: String): AttachmentDownloadJob? = synchronized(LOCK) { readAllLocked()[jobId] }

    fun remove(jobId: String) = synchronized(LOCK) {
        val jobs = readAllLocked().toMutableMap()
        jobs.remove(jobId)
        persist(jobs)
    }

    fun clear() = synchronized(LOCK) {
        persist(emptyMap())
    }

    fun unfinished(): List<AttachmentDownloadJob> = synchronized(LOCK) {
        readAllLocked().values.filter { it.isActive() }
    }

    fun all(): Map<String, AttachmentDownloadJob> = synchronized(LOCK) { readAllLocked() }

    private fun readAllLocked(): Map<String, AttachmentDownloadJob> {
        val raw = prefs.getString(KEY, "[]") ?: "[]"
        val array = JSONArray(raw)
        val map = linkedMapOf<String, AttachmentDownloadJob>()
        for (i in 0 until array.length()) {
            val job = AttachmentDownloadJob.fromJson(array.getJSONObject(i))
            map[job.jobId] = job
        }
        return map
    }

    private fun persist(jobs: Map<String, AttachmentDownloadJob>) {
        val array = JSONArray()
        jobs.values.forEach { array.put(it.toJson()) }
        prefs.edit().putString(KEY, array.toString()).commit()
    }

    companion object {
        private const val PREFS = "attachment_downloads"
        private const val KEY = "jobs"
        private val LOCK = Any()
    }
}
