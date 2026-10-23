import ExpoModulesCore
import UIKit

/**
 * Cuts rounded holes out of its subviews with a layer mask.
 *
 * The mask is opaque everywhere but the holes, which are cleared out of it —
 * clearing rather than an even-odd path, so holes that overlap still read as
 * one. It is drawn once per change of size or holes, at screen scale, and the
 * compositor applies it from then on. With no holes there is no mask.
 */
final class XyneCutoutView: ExpoView {
  struct Hole: Equatable {
    let rect: CGRect
    let radius: CGFloat
  }

  private let maskLayer = CutoutMaskLayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    maskLayer.needsDisplayOnBoundsChange = true
  }

  func setHoles(_ holes: [Hole]) {
    guard holes != maskLayer.holes else { return }
    maskLayer.holes = holes
    layer.mask = holes.isEmpty ? nil : maskLayer
    maskLayer.setNeedsDisplay()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    maskLayer.contentsScale = max(traitCollection.displayScale, 1)
    maskLayer.frame = bounds
    CATransaction.commit()
  }
}

private final class CutoutMaskLayer: CALayer {
  var holes: [XyneCutoutView.Hole] = []

  override func draw(in ctx: CGContext) {
    ctx.setFillColor(UIColor.white.cgColor)
    ctx.fill(bounds)
    ctx.setBlendMode(.clear)
    for hole in holes {
      // `CGPath` asks for a radius no larger than half a side; at exactly half
      // the rect is a circle.
      let radius = min(hole.radius, hole.rect.width / 2, hole.rect.height / 2)
      ctx.addPath(
        CGPath(roundedRect: hole.rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
      ctx.fillPath()
    }
  }
}
