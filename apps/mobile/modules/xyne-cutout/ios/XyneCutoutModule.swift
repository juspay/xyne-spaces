import ExpoModulesCore

/** One hole, in points of the view's own coordinates. */
struct CutoutHole: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var radius: Double = 0
}

public final class XyneCutoutModule: Module {
  public func definition() -> ModuleDefinition {
    Name("XyneCutout")

    // Named after its class, `XyneCutoutView` — the name the JS side asks for.
    View(XyneCutoutView.self) {
      Prop("holes") { (view: XyneCutoutView, holes: [CutoutHole]?) in
        view.setHoles(
          (holes ?? []).map {
            XyneCutoutView.Hole(
              rect: CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height),
              radius: CGFloat($0.radius)
            )
          }
        )
      }
    }
  }
}
