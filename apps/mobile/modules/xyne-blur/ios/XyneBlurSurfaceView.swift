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
 * `fadeHeight` fades the surface in from its top edge: the same mask, with
 * the same stops, as Android's (`XyneBlurSpec.Fade`). The mask goes on the effect view
 * itself — a `UIVisualEffectView` blurs properly under its own `mask`, not
 * under a mask on a layer above it.
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
  private var fadeHeight: CGFloat = 0
  private let effectFade = FadeMaskView()
  private let tintFade = FadeMaskView()

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

  /** How far below the top edge the surface reaches full strength, in points; 0 for no fade. */
  func setFadeHeight(_ height: CGFloat) {
    guard height != fadeHeight else { return }
    fadeHeight = height
    effectView.mask = height > 0 ? effectFade : nil
    tintView.mask = height > 0 ? tintFade : nil
    setNeedsLayout()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    guard fadeHeight > 0 else { return }
    for mask in [effectFade, tintFade] {
      mask.update(size: bounds.size, fadeHeight: fadeHeight)
    }
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

/**
 * The fade mask: black at these alphas, evenly spaced from the top edge
 * down to the fade height, and opaque from there to the bottom.
 */
private final class FadeMaskView: UIView {
  private static let alphas: [CGFloat] = [0x00, 0x60, 0xB0, 0xE8, 0xFF].map { $0 / 255 }

  override class var layerClass: AnyClass { CAGradientLayer.self }

  private var gradient: CAGradientLayer { layer as! CAGradientLayer }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    gradient.startPoint = CGPoint(x: 0.5, y: 0)
    gradient.endPoint = CGPoint(x: 0.5, y: 1)
    // The last stop holds full strength from the fade height to the bottom.
    gradient.colors = (Self.alphas + [1]).map { UIColor.black.withAlphaComponent($0).cgColor }
  }

  required init?(coder: NSCoder) { nil }

  func update(size: CGSize, fadeHeight: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    frame = CGRect(origin: .zero, size: size)
    let span: Double = size.height > 0 ? Double(min(fadeHeight / size.height, 1)) : 1
    let last = Double(Self.alphas.count - 1)
    var locations: [NSNumber] = []
    for index in 0..<Self.alphas.count {
      locations.append(NSNumber(value: Double(index) / last * span))
    }
    locations.append(1)
    gradient.locations = locations
    CATransaction.commit()
  }
}
