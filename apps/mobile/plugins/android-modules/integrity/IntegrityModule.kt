package net.juspay.xynespaces.integrity

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * Read-only view of [IntegrityGuard]'s verdict, for telemetry and diagnostics.
 *
 * Enforcement deliberately does not live here. By the time JS can call this, the guard has
 * already run in MainApplication/MainActivity and a tampered build has been sent to
 * [TamperBlockActivity] — so in practice this reports "ok" or reports that enforcement is off.
 */
class IntegrityModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    @ReactMethod
    fun getStatus(promise: Promise) {
        val map = WritableNativeMap()
        map.putBoolean("enforced", IntegrityGuard.isEnforced)
        map.putBoolean("ok", IntegrityGuard.check(reactApplicationContext))
        val failure = IntegrityGuard.lastFailure
        if (failure != null) {
            map.putString("failure", failure.name)
        } else {
            map.putNull("failure")
        }
        promise.resolve(map)
    }

    companion object {
        const val NAME = "IntegrityModule"
    }
}
