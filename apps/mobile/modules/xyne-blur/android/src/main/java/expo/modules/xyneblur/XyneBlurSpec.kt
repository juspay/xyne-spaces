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
  // makes blurring the shrunk copy match blurring the full-size content.
  private const val BLUR_SIGMA_SCALE = 0.57735f

  private fun radiusToSigma(radius: Float): Float =
    if (radius > 0f) BLUR_SIGMA_SCALE * radius + 0.5f else 0f

  private fun sigmaToRadius(sigma: Float): Float =
    if (sigma > 0.5f) (sigma - 0.5f) / BLUR_SIGMA_SCALE else 0f

  /**
   * Saturation first, then the blur: `createChainEffect(outer, inner)` applies
   * its inner (second) effect first.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  fun createEffect(density: Float): RenderEffect =
    createSaturatedBlur(downscaledRadius(RADIUS_DP * density, DOWNSCALE))

  @RequiresApi(Build.VERSION_CODES.S)
  private fun createSaturatedBlur(radius: Float): RenderEffect {
    val saturation = ColorMatrix().apply { setSaturation(SATURATION) }
    return RenderEffect.createChainEffect(
      RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP),
      RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(saturation)),
    )
  }

  /**
   * Liquid glass, for the bar's floating pieces.
   *
   * Glass is clear, not frosted: what it shows is only lightly softened, and
   * the effect comes from the rim, which bends the content behind it the way a
   * thick rounded pane of glass would.
   */
  object Glass {
    /** The content is captured at 1/4 size — sharper than the frost's 1/8. */
    const val DOWNSCALE = 4

    /** Just enough blur to take the edge off text passing under the glass. */
    const val RADIUS_DP = 6f

    /** Glass only bends what is right behind its rim, so it needs little margin. */
    const val CAPTURE_MARGIN_DP = 16f

    /** Width of the curved rim, before it is capped to a fifth of the shorter side. */
    const val THICKNESS_DP = 11f

    /** Refractive index of the glass: 1.5, about that of window glass. */
    const val REFRACTIVE_INDEX = 1.5f

    /** How far the rim's bend is applied, from 0 (flat pane) to 1. */
    const val REFRACTION_STRENGTH = 0.75f

    @RequiresApi(Build.VERSION_CODES.S)
    fun createEffect(density: Float): RenderEffect =
      createSaturatedBlur(downscaledRadius(RADIUS_DP * density, DOWNSCALE))

    /**
     * The glass pass, run over the surface's own pixels.
     *
     * The surface is a rounded rect, described by its signed distance field.
     * Inside the rim the pane is flat and passes the content straight through.
     * Across the rim its cross-section is a quarter circle: the surface normal
     * tilts outward until it lies flat at the very edge. A ray looking straight
     * down is refracted through that normal and lands on the content some way
     * inward — further the deeper the glass is at that point — which is what
     * gives the edge its lens. The surface's tint then goes over the top.
     */
    const val SHADER = """
      uniform shader content;
      uniform float2 halfSize;
      uniform float cornerRadius;
      uniform float thickness;
      uniform float refractiveIndex;
      uniform float strength;
      uniform float4 tint;

      float edgeDistance(float2 p) {
        float2 q = abs(p) - halfSize + cornerRadius;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cornerRadius;
      }

      half4 main(float2 coord) {
        float2 p = coord - halfSize;
        float d = edgeDistance(p);
        float2 uv = coord;
        if (d < 0.0 && d > -thickness) {
          float2 outward = float2(edgeDistance(p + float2(1.0, 0.0)) - d,
                                  edgeDistance(p + float2(0.0, 1.0)) - d);
          float tilt = (thickness + d) / thickness;
          float3 normal = normalize(float3(outward * tilt, sqrt(1.0 - tilt * tilt)));
          float3 ray = refract(float3(0.0, 0.0, -1.0), normal, 1.0 / refractiveIndex);
          float depth = sqrt(-d * (2.0 * thickness + d));
          uv += ray.xy * (depth + 8.0 * thickness) / -ray.z * strength;
        }
        half4 below = content.eval(uv);
        return half4(tint) + below * (1.0 - half(tint.a));
      }
    """
  }

  /**
   * The fade along a surface's top edge, as behind the bottom bar.
   *
   * The surface is drawn whole, then masked: invisible at the top edge, full
   * strength [fadeHeight] below it and all the way down from there. The blur is
   * the same everywhere; only how much of it shows changes, which is what reads
   * as a blur that builds up.
   */
  object Fade {
    /**
     * The mask: black at these alphas, evenly spaced from the top edge to the
     * fade height, and opaque from there down.
     */
    val ALPHAS = intArrayOf(0x00, 0x60, 0xB0, 0xE8, 0xFF)
  }

  /** The radius to use on a copy shrunk by [downscale] for a given full-size radius. */
  private fun downscaledRadius(radiusPx: Float, downscale: Int): Float =
    max(1f, sigmaToRadius(radiusToSigma(radiusPx) / downscale))
}
