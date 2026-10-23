package expo.modules.xyneimage

import android.content.Context
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Trace
import android.util.Log
import com.bumptech.glide.Glide
import com.bumptech.glide.load.Options
import com.bumptech.glide.load.ResourceDecoder
import com.bumptech.glide.load.engine.Resource
import com.bumptech.glide.load.resource.drawable.DrawableResource
import com.bumptech.glide.load.resource.transcode.ResourceTranscoder
import com.github.penfeizhou.animation.decode.FrameSeqDecoder
import com.github.penfeizhou.animation.glide.AnimationDecoderOption
import com.github.penfeizhou.animation.glide.ByteBufferAnimationDecoder
import com.github.penfeizhou.animation.glide.StreamAnimationDecoder
import java.io.InputStream
import java.nio.ByteBuffer

/** The plugin's decoders are declared over the raw Java type. */
private typealias AnyFrameSeqDecoder = FrameSeqDecoder<*, *>

/**
 * Makes animated images (GIF, animated WebP, APNG, AVIF) decode at the size
 * they are shown rather than the size they were uploaded at.
 *
 * expo-image plays them through Glide and APNG4Android. That decoder can render
 * each frame shrunk by a power of two, but nothing asks it to: a 500px profile
 * GIF shown as a 48dp avatar is decoded at 500px on every frame of every loop,
 * uploaded to the GPU at 500px, and only then scaled down — up to sixteen times
 * the pixels the avatar needs, on the decoder threads and on the render thread.
 *
 * Telegram decodes its animated avatars at their rendering size for the same
 * reason (`AnimatedFileDrawable`'s `renderingWidth`/`renderingHeight`).
 *
 * The plugin's own drawable would undo that: it re-derives the sample from its
 * bounds, and an image view sizes a drawable to its intrinsic size — the file's
 * full size — before scaling it into the view. The drawable made here reports
 * the shrunk size as its intrinsic size instead, so the sample holds and the
 * view's own matrix scales the result into place as before.
 *
 * That drawable also stops the decoding from repeating: it plays a
 * [SharedAnimation], which decodes each frame once and loops from the frames it
 * kept.
 *
 * Registered in front of the plugin. The plugin's decoders still parse the
 * file; only the drawable differs. Requests for a `Bitmap` never come here.
 */
internal object AnimatedImageSizing {
  private const val TAG = "XyneImage"

  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    synchronized(this) {
      if (installed) return
      installed = true
      try {
        // The stream decoder reads the stream into a buffer and hands it to
        // the buffer decoder, so one plugin decoder serves both.
        val pluginDecoder = ByteBufferAnimationDecoder()
        // Prepended, so these come before the plugin's and Glide's own
        // decoders for the same data; whatever they do not handle still
        // reaches those. `SizedAnimation` is only ever turned into a drawable
        // by the transcoder registered alongside it.
        Glide.get(context)
          .registry
          .prepend(
            InputStream::class.java,
            SizedAnimation::class.java,
            SizedDecoder(StreamAnimationDecoder(pluginDecoder)),
          )
          .prepend(ByteBuffer::class.java, SizedAnimation::class.java, SizedDecoder(pluginDecoder))
          .register(SizedAnimation::class.java, Drawable::class.java, SizedDrawableTranscoder)
      } catch (error: LinkageError) {
        // expo-image stopped shipping the plugin, or changed its API. Animated
        // images then decode exactly as they did before this module.
        Log.w(TAG, "Animated image sizing not installed", error)
      }
    }
  }

  /** A decoded animation and the sample it is to be drawn at. */
  class SizedAnimation(val decoder: AnyFrameSeqDecoder, val sample: Int)

  /**
   * Runs the plugin's decoder, then works out the power-of-two sample that
   * keeps the frames at least as large as the size Glide is loading for — a
   * 500px file for a 126px avatar is drawn at 250px.
   */
  private class SizedDecoder<T : Any>(
    private val inner: ResourceDecoder<T, AnyFrameSeqDecoder>,
  ) : ResourceDecoder<T, SizedAnimation> {
    override fun handles(source: T, options: Options): Boolean = inner.handles(source, options)

    override fun decode(source: T, width: Int, height: Int, options: Options): Resource<SizedAnimation>? {
      val decoded = inner.decode(source, width, height, options) ?: return null
      val decoder = decoded.get()
      val sample =
        if (width > 0 && height > 0) {
          Trace.beginSection("XyneImage.sizeAnimatedImage")
          try {
            decoder.setDesiredSize(width, height).also { sample ->
              // What was asked for, what the file is and what it settled on,
              // so a system trace shows whether the sizing took.
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Trace.isEnabled()) {
                val bounds = decoder.bounds
                Trace.beginSection(
                  "XyneImage target=${width}x$height source=${bounds.width()}x${bounds.height()} sample=$sample"
                )
                Trace.endSection()
              }
            }
          } finally {
            Trace.endSection()
          }
        } else {
          1
        }
      return SizedAnimationResource(decoded, SizedAnimation(decoder, sample))
    }
  }

  private class SizedAnimationResource(
    private val decoded: Resource<AnyFrameSeqDecoder>,
    private val animation: SizedAnimation,
  ) : Resource<SizedAnimation> {
    override fun getResourceClass(): Class<SizedAnimation> = SizedAnimation::class.java

    override fun get(): SizedAnimation = animation

    override fun getSize(): Int = decoded.size

    override fun recycle() = decoded.recycle()
  }

  /**
   * Turns a decoded animation into the drawable an image view holds: a
   * [SharedAnimationDrawable] onto the one [SharedAnimation] for that decoder,
   * which plays it once from the decoder and then from kept frames.
   *
   * It reports the decoded size, the file's size divided by the sample, as its
   * own, unless the request opted out of measuring as the plugin allows.
   */
  private object SizedDrawableTranscoder : ResourceTranscoder<SizedAnimation, Drawable> {
    override fun transcode(toTranscode: Resource<SizedAnimation>, options: Options): Resource<Drawable> {
      val animation = toTranscode.get()
      val bounds = animation.decoder.bounds
      val noMeasure = options.get(AnimationDecoderOption.NO_ANIMATION_BOUNDS_MEASURE) == true
      val width = if (noMeasure) -1 else maxOf(1, bounds.width() / animation.sample)
      val height = if (noMeasure) -1 else maxOf(1, bounds.height() / animation.sample)
      val drawable = SharedAnimationDrawable(SharedAnimation.of(animation.decoder), width, height)
      return AnimationDrawableResource(drawable, maxOf(1, width) * maxOf(1, height) * 4)
    }
  }

  private class AnimationDrawableResource(
    private val animation: SharedAnimationDrawable,
    private val size: Int,
  ) : DrawableResource<Drawable>(animation) {
    override fun getResourceClass(): Class<Drawable> = Drawable::class.java

    override fun getSize(): Int = size

    override fun recycle() = animation.stop()
  }
}
