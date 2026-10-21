package expo.modules.xyneblur

import android.content.Context
import android.graphics.Canvas
import android.graphics.RenderNode
import android.os.Build
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference

/**
 * Wraps the content a blur surface shows through — a screen's list.
 *
 * While drawing, it records its children into its own `RenderNode` and then
 * draws that node to the screen. A surface draws the same node again, shrunk
 * and blurred. Nothing is copied: a node is a list of drawing commands that
 * points at its children's nodes, so when a row scrolls or changes, the
 * renderer redraws the blurred copy from the new content without this view
 * or the surface doing anything.
 *
 * Dimezis' BlurView (`BlurTarget`) works the same way.
 *
 * A surface must never sit inside the target it blurs: it would be drawing a
 * node that contains itself.
 */
class XyneBlurTargetView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Null before API 31, where there is no blur to feed. */
  internal val renderNode: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) RenderNode("XyneBlurTarget") else null

  override fun dispatchDraw(canvas: Canvas) {
    val node = renderNode
    if (node == null || !canvas.isHardwareAccelerated) {
      super.dispatchDraw(canvas)
      return
    }
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording()
    try {
      super.dispatchDraw(recording)
    } finally {
      node.endRecording()
    }
    canvas.drawRenderNode(node)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    BlurTargets.add(this)
  }

  override fun onDetachedFromWindow() {
    BlurTargets.remove(this)
    super.onDetachedFromWindow()
  }
}

/**
 * Every target currently on screen.
 *
 * A surface does not name its target; it draws whichever targets lie behind it.
 * That is what lets the bottom bar, which lives outside every screen, blur the
 * screen that happens to be showing. Weak, so a target dropped without a detach
 * cannot leak.
 */
internal object BlurTargets {
  // Readable from `forEach`, which is inline so a surface can walk the targets
  // every frame without allocating a lambda.
  @PublishedApi
  internal val targets = ArrayList<WeakReference<XyneBlurTargetView>>()

  fun add(target: XyneBlurTargetView) {
    targets.removeAll { it.get() == null || it.get() === target }
    targets.add(WeakReference(target))
  }

  fun remove(target: XyneBlurTargetView) {
    targets.removeAll { it.get() == null || it.get() === target }
  }

  inline fun forEach(block: (XyneBlurTargetView) -> Unit) {
    for (index in targets.indices) {
      targets[index].get()?.let(block)
    }
  }
}
