package expo.modules.xyneimage

import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Trace
import com.github.penfeizhou.animation.decode.FrameSeqDecoder
import com.github.penfeizhou.animation.decode.XyneDecoderAccess
import java.nio.ByteBuffer
import java.lang.ref.WeakReference
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One animated image, played once by its decoder and from then on from memory.
 *
 * Decoding a GIF frame means unpacking it at the file's full size, even when it
 * is drawn at a quarter of that, and the decoder does it again on every loop
 * for as long as the image is on screen. Telegram decodes each frame of an
 * animated avatar once, keeps it at the size it is drawn, and loops from what
 * it kept (`AnimatedFileDrawable` with its `BitmapsCache`). This does the same,
 * in memory:
 *
 * - **Capturing.** The decoder plays as before. Each frame it composites is
 *   copied once, at the decoder's (already shrunk) size, and shown.
 * - **Ready.** With every frame kept, the decoder stops and a timer on the main
 *   thread steps through the kept frames at their own durations. Nothing is
 *   decoded any more.
 * - **Live.** An animation too large for the memory budget skips the keeping
 *   and plays from its decoder exactly as it did before.
 *
 * Every drawable showing the same decoded image shares one of these, so two
 * rows showing the same person decode, keep and step it once. It plays while
 * at least one of them is running and visible, and does nothing otherwise.
 *
 * State lives on the main thread. The decoder's worker thread only copies
 * pixels and hands them over.
 */
internal class SharedAnimation private constructor(
  private val decoder: FrameSeqDecoder<*, *>,
) : FrameSeqDecoder.RenderListener {
  private enum class State { CAPTURING, READY, LIVE }

  private val main = Handler(Looper.getMainLooper())
  private var state = State.CAPTURING

  /** Drawables currently running and visible. */
  private val clients = LinkedHashSet<SharedAnimationDrawable>()

  /** What every drawable draws. Replaced, never written into, except while live. */
  @Volatile var current: Bitmap? = null
    private set

  // Kept frames, filled by index while capturing. Main thread.
  private var frames: Array<Bitmap?> = emptyArray()
  private var durations = IntArray(0)
  private var kept = 0
  private var bytes = 0L
  private var loopCount = 0

  // Ready: the timer's position.
  private var index = 0
  private var loopsPlayed = 0

  // Capturing or live: whether the decoder is playing for us.
  private var listening = false
  private var decoding = false

  /** Read on the worker thread: copy each frame to keep it, or into one reused bitmap. */
  @Volatile private var keeping = true
  private var liveBitmap: Bitmap? = null
  private val invalidatePending = AtomicBoolean(false)

  fun setPlaying(drawable: SharedAnimationDrawable, playing: Boolean) {
    val changed = if (playing) clients.add(drawable) else clients.remove(drawable)
    if (!changed) return
    FrameBudget.touch(this)
    reconcile()
  }

  val isPlaying: Boolean
    get() = clients.isNotEmpty()

  private fun reconcile() {
    if (clients.isEmpty()) {
      main.removeCallbacks(tick)
      if (decoding) {
        decoder.stop()
        decoding = false
      }
      return
    }
    if (state == State.READY) {
      main.removeCallbacks(tick)
      main.postDelayed(tick, durations[index].toLong())
      return
    }
    if (!listening) {
      decoder.addRenderListener(this)
      listening = true
    }
    if (!decoding) {
      decoder.start()
      decoding = true
    }
  }

  private val tick =
    object : Runnable {
      override fun run() {
        if (state != State.READY || clients.isEmpty()) return
        var next = index + 1
        if (next >= frames.size) {
          next = 0
          loopsPlayed++
          // A file that asks to be played a set number of times stops on its
          // last frame, as the decoder would have.
          if (loopCount in 1..loopsPlayed) return
        }
        index = next
        current = frames[next]
        invalidateClients()
        main.postDelayed(this, durations[next].toLong())
      }
    }

  // --- Decoder callbacks (worker thread) ------------------------------------

  override fun onStart() = Unit

  override fun onRender(buffer: ByteBuffer) {
    val sample = decoder.sampleSize
    val bounds = decoder.bounds
    val width = maxOf(1, bounds.width() / sample)
    val height = maxOf(1, bounds.height() / sample)
    buffer.rewind()

    if (!keeping) {
      val bitmap =
        liveBitmap?.takeIf { !it.isRecycled && it.width == width && it.height == height }
          ?: Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { liveBitmap = it }
      if (buffer.remaining() < bitmap.byteCount) return
      bitmap.copyPixelsFromBuffer(buffer)
      current = bitmap
      postInvalidate()
      return
    }

    val frameIndex = decoder.frameIndex
    val frameCount = decoder.frameCount
    val duration = decoder.getFrame(frameIndex)?.frameDuration ?: return
    val frame = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    if (buffer.remaining() < frame.byteCount) return
    traced("XyneImage.keepFrame") { frame.copyPixelsFromBuffer(buffer) }
    main.post { onFrameKept(frame, frameIndex, frameCount, duration) }
  }

  override fun onEnd() {
    main.post { decoding = false }
  }

  // --- Main thread ------------------------------------------------------------

  private fun onFrameKept(frame: Bitmap, frameIndex: Int, frameCount: Int, duration: Int) {
    if (state != State.CAPTURING) return
    if (frames.isEmpty()) {
      // The whole animation, kept, at this frame's size.
      if (frameCount.toLong() * frame.byteCount > FrameBudget.MAX_PER_ANIMATION) {
        goLive()
        current = frame
        invalidateClients()
        return
      }
      frames = arrayOfNulls(frameCount)
      durations = IntArray(frameCount)
      loopCount = XyneDecoderAccess.loopCount(decoder)
    }
    if (frameIndex !in frames.indices) return

    if (frames[frameIndex] == null) {
      if (!FrameBudget.reserve(this, frame.byteCount.toLong())) {
        goLive()
        current = frame
        invalidateClients()
        return
      }
      frames[frameIndex] = frame
      // A zero or tiny delay plays as fast as the screen refreshes; the
      // decoder would spin on it.
      durations[frameIndex] = maxOf(duration, MIN_FRAME_MS)
      bytes += frame.byteCount
      kept++
    }
    current = frames[frameIndex]
    invalidateClients()

    if (kept == frames.size) becomeReady(frameIndex)
  }

  private fun becomeReady(lastIndex: Int) {
    state = State.READY
    decoder.removeRenderListener(this)
    listening = false
    if (decoding) {
      decoder.stop()
      decoding = false
    }
    index = lastIndex
    loopsPlayed = 1
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Trace.isEnabled()) {
      Trace.beginSection("XyneImage kept frames=${frames.size} bytes=$bytes")
      Trace.endSection()
    }
    if (clients.isNotEmpty()) {
      main.postDelayed(tick, durations[index].toLong())
    }
  }

  /** Over budget: hand back what was kept and play from the decoder as before. */
  private fun goLive() {
    state = State.LIVE
    keeping = false
    releaseFrames()
  }

  /**
   * Called by the budget to make room. Only ever an animation nobody is
   * playing: it keeps the frame on screen and captures again when next played.
   */
  fun evict() {
    if (state == State.LIVE) return
    main.removeCallbacks(tick)
    releaseFrames()
    state = State.CAPTURING
  }

  private fun releaseFrames() {
    FrameBudget.release(this, bytes)
    frames = emptyArray()
    durations = IntArray(0)
    kept = 0
    bytes = 0
  }

  private fun postInvalidate() {
    if (invalidatePending.compareAndSet(false, true)) {
      main.post {
        invalidatePending.set(false)
        invalidateClients()
      }
    }
  }

  private fun invalidateClients() {
    for (client in clients) client.invalidateSelf()
  }

  companion object {
    /** No frame shows for less than this, whatever the file says. */
    private const val MIN_FRAME_MS = 20

    private val shared = WeakHashMap<FrameSeqDecoder<*, *>, WeakReference<SharedAnimation>>()

    /** The one shared animation for this decoder, made on first use. */
    @Synchronized
    fun of(decoder: FrameSeqDecoder<*, *>): SharedAnimation =
      shared[decoder]?.get() ?: SharedAnimation(decoder).also {
        shared[decoder] = WeakReference(it)
      }
  }
}

/**
 * The memory all kept frames may take together, across every animation.
 *
 * When a new frame does not fit, the animations nobody is playing give theirs
 * up, least recently played first. If that is still not enough, the animation
 * asking plays live instead. Main thread only.
 */
internal object FrameBudget {
  /** All kept frames together. */
  private const val MAX_TOTAL = 24L * 1024 * 1024

  /** One animation's frames; larger ones play live. A 60-frame GIF at 126px is about 4 MB. */
  const val MAX_PER_ANIMATION = 8L * 1024 * 1024

  private var used = 0L

  /** Animations holding frames, least recently played first. */
  private val holders = LinkedHashSet<SharedAnimation>()

  fun touch(animation: SharedAnimation) {
    if (holders.remove(animation)) holders.add(animation)
  }

  fun reserve(animation: SharedAnimation, bytes: Long): Boolean {
    if (used + bytes > MAX_TOTAL) {
      val idle = holders.filter { it !== animation && !it.isPlaying }
      for (victim in idle) {
        if (used + bytes <= MAX_TOTAL) break
        victim.evict()
      }
      if (used + bytes > MAX_TOTAL) return false
    }
    used += bytes
    holders.remove(animation)
    holders.add(animation)
    return true
  }

  fun release(animation: SharedAnimation, bytes: Long) {
    used = maxOf(0L, used - bytes)
    holders.remove(animation)
  }
}

private inline fun <T> traced(name: String, block: () -> T): T {
  Trace.beginSection(name)
  try {
    return block()
  } finally {
    Trace.endSection()
  }
}
