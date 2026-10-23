package expo.modules.xyneimage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Nothing for JS to call. The module exists for its `OnCreate`, which Expo runs
 * for every module as the app's module registry starts — before React has
 * mounted a single image, which is when the decoders have to be in place.
 */
class XyneImageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("XyneImage")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      AnimatedImageSizing.install(context.applicationContext)
    }
  }
}
