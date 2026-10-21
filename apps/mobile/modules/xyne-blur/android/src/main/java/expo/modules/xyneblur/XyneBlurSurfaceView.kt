package expo.modules.xyneblur

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A frosted surface — the header's or the bottom bar's background.
 *
 * Three layers, back to front:
 *
 *  1. The content behind it — every `XyneBlurTargetView` it overlaps — on the
 *     screen's background colour, shrunk to 1/8, colour-boosted 3x, blurred,
 *     and scaled back up.
 *  2. A tint: the surface's own colour at [tintAlpha], so text on it
 *     stays readable and the content only shows through as colour and shape.
 *  3. Nothing else. Children, if any, draw on top as usual.
 *
 * The blurred layer is a `RenderNode` that points at the targets' nodes. When a
 * list scrolls, its node changes and the renderer redraws this one on its own;
 * this view only does work when something *moves* — the surface, or a target
 * (a screen sliding in). That check runs before each frame and costs a handful
 * of position reads.
 *
 * Before API 31 there is no `RenderEffect`, and the surface is the solid
 * background colour under the tint.
 *
 * [Material.GLASS] swaps the frost for liquid glass (see [XyneBlurSpec.Glass]):
 * a sharper capture, refracted through the surface's rounded rim by a shader,
 * with the tint applied in the same pass. It needs API 33 for runtime shaders;
 * below that the surface stays frosted.
 */
class XyneBlurSurfaceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** The screen's background, drawn under the content and wherever there is none. */
  var baseColor: Int = Color.TRANSPARENT
    set(value) {
      if (field == value) return
      field = value
      capture?.forceRecord()
      invalidate()
    }

  /** The surface's own colour, laid over the blur at [tintAlpha]. */
  var tintColor: Int = Color.TRANSPARENT
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  var tintAlpha: Float = 0f
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  enum class Material { FROST, GLASS }

  var material: Material = Material.FROST
    set(value) {
      if (field == value) return
      field = value
      capture?.release()
      glass?.release()
      glass = createGlass()
      capture = createCapture()
      invalidate()
    }

  /** The corner radius of the shape the surface is clipped to, in px. Glass bends light along it. */
  var cornerRadius: Float = 0f
    set(value) {
      if (field == value) return
      field = value
      if (glass != null) invalidate()
    }

  private val density = resources.displayMetrics.density

  /** Set when glass was asked for and the device can draw it; frost otherwise. */
  private var glass: Glass? = createGlass()
  private var capture: Capture? = createCapture()

  private fun createCapture(): Capture? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    return if (glass != null) {
      Capture(XyneBlurSpec.Glass.DOWNSCALE, XyneBlurSpec.Glass.createEffect(density), XyneBlurSpec.Glass.CAPTURE_MARGIN_DP)
    } else {
      Capture(XyneBlurSpec.DOWNSCALE, XyneBlurSpec.createEffect(density), XyneBlurSpec.CAPTURE_MARGIN_DP)
    }
  }

  private fun createGlass(): Glass? {
    if (material != Material.GLASS || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return null
    return try {
      Glass()
    } catch (error: IllegalArgumentException) {
      // The shader is compiled on the device. Should a GPU driver reject it,
      // the surface stays frosted rather than taking the screen down.
      Log.w(TAG, "Liquid glass shader unavailable; using the frost", error)
      null
    }
  }

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    // Invalidating here does not cost an extra frame: the frame this runs in
    // has not drawn yet, so the redraw joins it.
    if (isShown && capture?.update(this) == true) invalidate()
    true
  }

  init {
    setWillNotDraw(false)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(preDrawListener)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    capture?.release()
    glass?.release()
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    // Everything stays inside the surface. A parent that does not clip its
    // children would otherwise let `drawColor` cover the whole screen.
    val saved = canvas.save()
    canvas.clipRect(0, 0, width, height)

    val tint = Color.argb(
      (Color.alpha(tintColor) * tintAlpha).roundToInt().coerceIn(0, 255),
      Color.red(tintColor),
      Color.green(tintColor),
      Color.blue(tintColor),
    )

    val capture = capture
    val glass = glass
    if (capture != null && canvas.isHardwareAccelerated) {
      if (!capture.hasContent()) capture.update(this)
      canvas.drawColor(baseColor)
      if (glass != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        // The glass pass lays the tint itself, under its own highlights.
        glass.draw(canvas, capture, width, height, tint)
      } else {
        canvas.translate(capture.originX, capture.originY)
        canvas.drawRenderNode(capture.node)
        canvas.translate(-capture.originX, -capture.originY)
        if (Color.alpha(tint) != 0) canvas.drawColor(tint)
      }
      // A target that had not drawn yet has nothing to show; look again next frame.
      if (capture.waitingForTarget) postInvalidateOnAnimation()
    } else {
      canvas.drawColor(baseColor)
      if (Color.alpha(tint) != 0) canvas.drawColor(tint)
    }

    canvas.restoreToCount(saved)
  }

  /**
   * The liquid glass layer: the capture, drawn into a node the size of the
   * surface, with the glass shader as that node's effect.
   *
   * The node only holds a pointer to the capture, so content scrolling under
   * the glass updates it without this view redrawing. The shader's inputs are
   * pushed — and the effect rebuilt — only when one of them changes: a resize,
   * a radius step of the menu morph, a theme switch.
   */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private inner class Glass {
    private val node = RenderNode("XyneGlassSurface")
    private val shader = RuntimeShader(XyneBlurSpec.Glass.SHADER)
    private val thicknessPx = XyneBlurSpec.Glass.THICKNESS_DP * density

    private var appliedWidth = -1
    private var appliedHeight = -1
    private var appliedRadius = -1f
    private var appliedTint = 0

    fun draw(canvas: Canvas, capture: Capture, width: Int, height: Int, tint: Int) {
      node.setPosition(0, 0, width, height)
      val recording = node.beginRecording(width, height)
      try {
        recording.translate(capture.originX, capture.originY)
        recording.drawRenderNode(capture.node)
      } finally {
        node.endRecording()
      }
      applyShape(width, height, tint)
      canvas.drawRenderNode(node)
    }

    fun release() {
      node.discardDisplayList()
    }

    private fun applyShape(width: Int, height: Int, tint: Int) {
      val shortSide = min(width, height).toFloat()
      val radius = cornerRadius.coerceIn(0f, shortSide / 2f)
      if (
        width == appliedWidth &&
        height == appliedHeight &&
        abs(radius - appliedRadius) < 0.1f &&
        tint == appliedTint
      ) {
        return
      }
      appliedWidth = width
      appliedHeight = height
      appliedRadius = radius
      appliedTint = tint

      // A narrow surface keeps a flat middle: the rim takes at most a fifth of it.
      val thickness = thicknessPx.coerceAtMost(shortSide / 5f).coerceAtLeast(1f)
      val alpha = Color.alpha(tint) / 255f

      shader.setFloatUniform("halfSize", width / 2f, height / 2f)
      shader.setFloatUniform("cornerRadius", radius)
      shader.setFloatUniform("thickness", thickness)
      shader.setFloatUniform("refractiveIndex", XyneBlurSpec.Glass.REFRACTIVE_INDEX)
      shader.setFloatUniform("strength", XyneBlurSpec.Glass.REFRACTION_STRENGTH)
      // Premultiplied, as the shader composites it over the content directly.
      shader.setFloatUniform(
        "tint",
        Color.red(tint) / 255f * alpha,
        Color.green(tint) / 255f * alpha,
        Color.blue(tint) / 255f * alpha,
        alpha,
      )
      // An effect keeps the uniforms it was built with; new ones need a new effect.
      node.setRenderEffect(RenderEffect.createRuntimeShaderEffect(shader, "content"))
    }
  }

  /**
   * The blurred copy of what is behind the surface.
   *
   * Recorded at 1/[downscale] size: the targets are drawn into a node that
   * much smaller than the capture area, the node blurs and saturates itself,
   * and it is drawn back scaled up. For the frost's 1/8 the blur runs on 1/64
   * of the pixels.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private inner class Capture(
    private val downscale: Int,
    private val effect: RenderEffect,
    marginDp: Float,
  ) {
    val node = RenderNode("XyneBlurSurface")

    /** Where the node's top-left corner sits, relative to the surface. */
    var originX = 0f
      private set
    var originY = 0f
      private set
    var waitingForTarget = false
      private set

    private val margin = (marginDp * density).roundToInt()
    private val surfaceLocation = IntArray(2)
    private val targetLocation = IntArray(2)
    private var recordedKey = 0L
    private var recorded = false

    init {
      node.setPivotX(0f)
      node.setPivotY(0f)
      node.setScaleX(downscale.toFloat())
      node.setScaleY(downscale.toFloat())
      node.setRenderEffect(effect)
    }

    fun hasContent(): Boolean = recorded && node.hasDisplayList()

    fun forceRecord() {
      recorded = false
    }

    fun release() {
      node.discardDisplayList()
      recorded = false
    }

    /**
     * Re-records the node if the surface or anything behind it moved. Returns
     * whether it did, so the caller can redraw at the new origin.
     *
     * Scrolling inside a target is not a move: the node already points at the
     * target's content, which updates by itself.
     */
    fun update(surface: View): Boolean {
      val width = surface.width
      val height = surface.height
      if (width == 0 || height == 0 || !surface.isAttachedToWindow) return false

      surface.getLocationInWindow(surfaceLocation)
      val grid = XyneBlurSpec.GRID_PX
      val left = floorTo(surfaceLocation[0] - margin, grid)
      val top = floorTo(surfaceLocation[1] - margin, grid)
      val right = ceilTo(surfaceLocation[0] + width + margin, grid)
      val bottom = ceilTo(surfaceLocation[1] + height + margin, grid)
      val smallWidth = ceilDiv(right - left, downscale)
      val smallHeight = ceilDiv(bottom - top, downscale)

      originX = (left - surfaceLocation[0]).toFloat()
      originY = (top - surfaceLocation[1]).toFloat()

      // What would be recorded, reduced to one number. Equal means nothing moved.
      var key = mix(mix(mix(mix(17L, left), top), smallWidth), smallHeight)
      var waiting = false
      forEachTargetBehind(surface, left, top, right, bottom) { target, x, y ->
        if (target.renderNode?.hasDisplayList() != true) {
          waiting = true
        } else {
          key = mix(mix(mix(mix(mix(key, System.identityHashCode(target)), x), y), target.width), target.height)
        }
      }
      waitingForTarget = waiting

      if (recorded && key == recordedKey && node.hasDisplayList()) return false
      recordedKey = key
      recorded = true

      node.setPosition(0, 0, smallWidth, smallHeight)
      val canvas = node.beginRecording(smallWidth, smallHeight)
      try {
        // The screen's own background goes in first, so the blur has something to mix with beyond the content's edges.
        canvas.drawColor(baseColor)
        canvas.scale(1f / downscale, 1f / downscale)
        forEachTargetBehind(surface, left, top, right, bottom) { target, x, y ->
          val targetNode = target.renderNode
          if (targetNode != null && targetNode.hasDisplayList()) {
            canvas.save()
            canvas.translate(x.toFloat(), y.toFloat())
            canvas.drawRenderNode(targetNode)
            canvas.restore()
          }
        }
      } finally {
        node.endRecording()
      }

      // API 31 does not re-render a node with an effect when only its content
      // changes; setting the effect again forces it (as Dimezis' BlurView does).
      if (Build.VERSION.SDK_INT == Build.VERSION_CODES.S) node.setRenderEffect(effect)
      return true
    }

    /**
     * Every on-screen target that overlaps the capture area, with its position
     * relative to that area's top-left corner. A target that contains the
     * surface is skipped — it would draw itself.
     */
    private inline fun forEachTargetBehind(
      surface: View,
      left: Int,
      top: Int,
      right: Int,
      bottom: Int,
      block: (XyneBlurTargetView, Int, Int) -> Unit,
    ) {
      BlurTargets.forEach { target ->
        if (!target.isAttachedToWindow || target.windowToken != surface.windowToken) return@forEach
        if (!target.isShown || target.width == 0 || target.height == 0) return@forEach
        if (isAncestor(target, surface)) return@forEach
        target.getLocationInWindow(targetLocation)
        val targetLeft = targetLocation[0]
        val targetTop = targetLocation[1]
        if (targetLeft >= right || targetLeft + target.width <= left) return@forEach
        if (targetTop >= bottom || targetTop + target.height <= top) return@forEach
        block(target, targetLeft - left, targetTop - top)
      }
    }
  }

  private companion object {
    const val TAG = "XyneBlur"

    fun isAncestor(candidate: View, view: View): Boolean {
      var parent = view.parent
      while (parent is View) {
        if (parent === candidate) return true
        parent = parent.parent
      }
      return false
    }

    fun floorTo(value: Int, step: Int): Int = Math.floorDiv(value, step) * step

    fun ceilTo(value: Int, step: Int): Int = -Math.floorDiv(-value, step) * step

    fun ceilDiv(value: Int, divisor: Int): Int = (value + divisor - 1) / divisor

    fun mix(hash: Long, value: Int): Long = hash * 31 + value
  }
}
