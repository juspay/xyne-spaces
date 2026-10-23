package expo.modules.xyneblur

import android.graphics.Color
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class XyneBlurModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("XyneBlur")

    View(XyneBlurSurfaceView::class) {
      Name("XyneBlurSurfaceView")

      // Colours arrive as ARGB integers (`processColor` on the JS side) rather
      // than as `android.graphics.Color` objects, which need API 26.
      Prop("baseColor") { view: XyneBlurSurfaceView, color: Int? ->
        view.baseColor = color ?: Color.TRANSPARENT
      }

      Prop("tintColor") { view: XyneBlurSurfaceView, color: Int? ->
        view.tintColor = color ?: Color.TRANSPARENT
      }

      Prop("tintAlpha") { view: XyneBlurSurfaceView, alpha: Float ->
        view.tintAlpha = alpha.coerceIn(0f, 1f)
      }

      Prop("material") { view: XyneBlurSurfaceView, material: String? ->
        view.material =
          if (material == "glass") XyneBlurSurfaceView.Material.GLASS else XyneBlurSurfaceView.Material.FROST
      }

      // In dp, like every other length React hands over.
      Prop("fadeHeight") { view: XyneBlurSurfaceView, height: Float? ->
        view.fadeHeight = (height ?: 0f).coerceAtLeast(0f) * view.resources.displayMetrics.density
      }

      Prop("cornerRadius") { view: XyneBlurSurfaceView, radius: Float? ->
        view.cornerRadius = (radius ?: 0f).coerceAtLeast(0f) * view.resources.displayMetrics.density
      }
    }

    View(XyneBlurTargetView::class) {
      Name("XyneBlurTargetView")
    }
  }
}
