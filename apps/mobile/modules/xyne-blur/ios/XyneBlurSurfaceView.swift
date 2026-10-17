import ExpoModulesCore
import UIKit

/**
 * The iOS side of the frosted surface.
 *
 * UIKit does the capture and the blur itself: a `UIVisualEffectView` blurs
 * whatever is behind it, live, on the render server. What it does not expose is
 * the blur's radius — only private API reaches it, which is not something to
 * ship — so the system's thinnest material stands in for Android's 40dp blur,
 * and the tint on top is the same colour and opacity as on Android.
 *
 * Childless: React's children would be inserted under the effect view.
 */
public final class XyneBlurSurfaceView: ExpoView {
  private let effectView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
  private let tintView = UIView()

  // Not `tintColor`: UIView already has one, with a different meaning.
  private var surfaceTint: UIColor?
  private var surfaceTintAlpha: CGFloat = 0

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false

    for subview in [effectView, tintView] {
      subview.frame = bounds
      subview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      subview.isUserInteractionEnabled = false
      addSubview(subview)
    }
  }

  func setTint(color: UIColor?) {
    surfaceTint = color
    applyTint()
  }

  func setTint(alpha: CGFloat) {
    surfaceTintAlpha = alpha
    applyTint()
  }

  /** The app has its own light/dark switch, so the material follows it, not the system. */
  func setColorScheme(_ scheme: String?) {
    switch scheme {
    case "dark": overrideUserInterfaceStyle = .dark
    case "light": overrideUserInterfaceStyle = .light
    default: overrideUserInterfaceStyle = .unspecified
    }
  }

  private func applyTint() {
    tintView.backgroundColor = surfaceTint?.withAlphaComponent(surfaceTintAlpha)
  }
}
