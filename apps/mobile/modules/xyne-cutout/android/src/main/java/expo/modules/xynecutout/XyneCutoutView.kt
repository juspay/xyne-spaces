package expo.modules.xynecutout

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Cuts rounded holes out of its children.
 *
 * The children draw into a layer the size of this view, then each hole is
 * filled with a clearing paint, which leaves it transparent. On a hardware
 * canvas the layer is a texture on the GPU, so this is drawing work only: no
 * bitmap is made on the main thread, nothing is uploaded, and a recycled row
 * that moves or drops its holes just draws differently on the next frame.
 *
 * The same approach Telegram takes for its stacked avatars.
 *
 * With no holes it skips the layer and draws its children as any view would.
 */
class XyneCutoutView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val clearPaint =
    Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }

  /** Each hole as left, top, right, bottom, radius, in px. */
  private var holes = FloatArray(0)

  fun setHoles(holes: List<CutoutHole>, density: Float) {
    val next = FloatArray(holes.size * FIELDS)
    holes.forEachIndexed { index, hole ->
      val at = index * FIELDS
      next[at] = hole.x * density
      next[at + 1] = hole.y * density
      next[at + 2] = (hole.x + hole.width) * density
      next[at + 3] = (hole.y + hole.height) * density
      next[at + 4] = hole.radius * density
    }
    if (next.contentEquals(this.holes)) return
    this.holes = next
    invalidate()
  }

  /**
   * React Native places the children. `ExpoView` is a `LinearLayout`, and
   * left to it, the layout pass React Native's own frame update triggers would
   * stack the children top to bottom — a second child laid over the first,
   * like the tab icon's active colour over its resting one, would be pushed
   * out of the box and clipped away.
   */
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchDraw(canvas: Canvas) {
    if (holes.isEmpty()) {
      super.dispatchDraw(canvas)
      return
    }
    val save = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)
    super.dispatchDraw(canvas)
    var at = 0
    while (at < holes.size) {
      canvas.drawRoundRect(
        holes[at],
        holes[at + 1],
        holes[at + 2],
        holes[at + 3],
        holes[at + 4],
        holes[at + 4],
        clearPaint,
      )
      at += FIELDS
    }
    canvas.restoreToCount(save)
  }

  private companion object {
    const val FIELDS = 5
  }
}
