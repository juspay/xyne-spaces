package expo.modules.xyneblur

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import kotlin.math.max

/**
 * The numbers behind Xyne Blur's frosted header and bottom bar. Kept together so
 * the whole look can be tuned in one place.
 */
internal object XyneBlurSpec {
  /** The content is drawn at 1/8 size before it is blurred, then scaled back up. */
  const val DOWNSCALE = 8

  /** Blur radius, in dp of the full-size screen. */
  const val RADIUS_DP = 40f

  /** Colour boost applied before the blur, so colours bleed through the frost. */
  const val SATURATION = 3f

  /**
   * How far past the surface's edges the content is captured. The blur near an
   * edge then mixes in the real content beyond it rather than a clamped edge.
   */
  const val CAPTURE_MARGIN_DP = 48f

  /**
   * The capture area snaps to a 16px grid in window coordinates, so the 8x
   * downscale samples the same pixels from frame to frame instead of shimmering
   * as the surface moves.
   */
  const val GRID_PX = 16

  // Android's blur takes a "radius" and turns it into a Gaussian sigma with this
  // factor (frameworks/base/libs/hwui/utils/Blur.cpp). Converting through sigma
  // makes blurring the 1/8 copy match blurring the full-size content.
  private const val BLUR_SIGMA_SCALE = 0.57735f

  private fun radiusToSigma(radius: Float): Float =
    if (radius > 0f) BLUR_SIGMA_SCALE * radius + 0.5f else 0f

  private fun sigmaToRadius(sigma: Float): Float =
    if (sigma > 0.5f) (sigma - 0.5f) / BLUR_SIGMA_SCALE else 0f

  /** The radius to use on the downscaled copy for a given full-size radius. */
  fun downscaledRadius(radiusPx: Float): Float =
    max(1f, sigmaToRadius(radiusToSigma(radiusPx) / DOWNSCALE))

  /**
   * Saturation first, then the blur: `createChainEffect(outer, inner)` applies
   * its inner (second) effect first.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  fun createEffect(density: Float): RenderEffect {
    val radius = downscaledRadius(RADIUS_DP * density)
    val saturation = ColorMatrix().apply { setSaturation(SATURATION) }
    return RenderEffect.createChainEffect(
      RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP),
      RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(saturation)),
    )
  }
}
