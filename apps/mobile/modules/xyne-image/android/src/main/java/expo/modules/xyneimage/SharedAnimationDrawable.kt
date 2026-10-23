package expo.modules.xyneimage

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Animatable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper

/**
 * What an image view holds for an animated image: a window onto a
 * [SharedAnimation].
 *
 * It draws the animation's current frame scaled into its bounds, and tells the
 * animation whether it wants frames — while it is running and visible.
 * expo-image starts and stops it like any [Animatable].
 *
 * Its intrinsic size is the size frames are decoded at, the file's size
 * divided by the sample, so an image view lays it out at that size and scales
 * it into place as it would the original.
 */
internal class SharedAnimationDrawable(
  private val animation: SharedAnimation,
  private val intrinsicWidth: Int,
  private val intrinsicHeight: Int,
) : Drawable(), Animatable {
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
  private val main = Handler(Looper.getMainLooper())
  private var running = false

  override fun draw(canvas: Canvas) {
    val frame = animation.current ?: return
    if (frame.isRecycled) return
    canvas.drawBitmap(frame, null, bounds, paint)
  }

  override fun start() {
    if (running) return
    running = true
    update()
  }

  override fun stop() {
    if (!running) return
    running = false
    update()
  }

  override fun isRunning(): Boolean = running

  override fun setVisible(visible: Boolean, restart: Boolean): Boolean {
    val changed = super.setVisible(visible, restart)
    update()
    return changed
  }

  /** Glide and expo-image may call in from other threads; the animation lives on main. */
  private fun update() {
    val playing = running && isVisible
    if (Looper.myLooper() == Looper.getMainLooper()) {
      animation.setPlaying(this, playing)
    } else {
      main.post { animation.setPlaying(this, running && isVisible) }
    }
  }

  override fun getIntrinsicWidth(): Int = intrinsicWidth

  override fun getIntrinsicHeight(): Int = intrinsicHeight

  override fun setAlpha(alpha: Int) {
    paint.alpha = alpha
    invalidateSelf()
  }

  override fun setColorFilter(colorFilter: ColorFilter?) {
    paint.colorFilter = colorFilter
    invalidateSelf()
  }

  @Deprecated("Deprecated in Java")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

  /**
   * Glide hands a cached image to every view that asks for it through this:
   * each view gets a drawable of its own, all onto the one animation, so each
   * starts, stops and invalidates on its own.
   */
  override fun getConstantState(): ConstantState = State(animation, intrinsicWidth, intrinsicHeight)

  private class State(
    private val animation: SharedAnimation,
    private val width: Int,
    private val height: Int,
  ) : ConstantState() {
    override fun newDrawable(): Drawable = SharedAnimationDrawable(animation, width, height)

    override fun getChangingConfigurations(): Int = 0
  }
}
