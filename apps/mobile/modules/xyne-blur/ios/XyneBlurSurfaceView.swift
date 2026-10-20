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
 * The `glass` material is the system's own Liquid Glass on iOS 26, shaped to
 * the surface's corner radius. It is left untinted: Apple's glass keeps what is
 * on it legible by itself, and a tint at the frost's opacity would hide the
 * glass. Before iOS 26 the surface stays frosted.
 *
 * Childless: React's children would be inserted under the effect view.
 */
public final class XyneBlurSurfaceView: ExpoView {
  private let effectView = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
  private let tintView = UIView()

  // Not `tintColor`: UIView already has one, with a different meaning.
  private var surfaceTint: UIColor?
  private var surfaceTintAlpha: CGFloat = 0
  private var usesGlass = false

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

  func setMaterial(_ material: String?) {
    var glass = false
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), material == "glass" {
      glass = true
    }
    #endif
    guard glass != usesGlass else { return }
    usesGlass = glass
    applyEffect()
    applyTint()
  }

  func setCornerRadius(_ radius: CGFloat) {
    effectView.layer.cornerRadius = radius
    effectView.layer.cornerCurve = .circular
  }

  private func applyEffect() {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), usesGlass {
      effectView.effect = UIGlassEffect(style: .regular)
      return
    }
    #endif
    effectView.effect = UIBlurEffect(style: .systemUltraThinMaterial)
  }

  private func applyTint() {
    tintView.backgroundColor = usesGlass ? nil : surfaceTint?.withAlphaComponent(surfaceTintAlpha)
  }
}
