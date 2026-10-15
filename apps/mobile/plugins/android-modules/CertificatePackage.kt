package net.juspay.xynespaces.certificate

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CertificatePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val certificateManager =
            CertificateManager.getInstanceOrNull()
                ?: CertificateManager.initialize(reactContext.applicationContext)
        return listOf(CertificateModule(reactContext, certificateManager))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}