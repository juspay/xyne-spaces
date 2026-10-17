import ExpoModulesCore

public final class XyneBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("XyneBlur")

    // Named after its class, `XyneBlurSurfaceView` — the name the JS side asks
    // for. iOS's view builder takes no `Name(…)` here, unlike Android's.
    View(XyneBlurSurfaceView.self) {
      Prop("tintColor") { (view: XyneBlurSurfaceView, color: UIColor?) in
        view.setTint(color: color)
      }

      Prop("tintAlpha") { (view: XyneBlurSurfaceView, alpha: Double) in
        view.setTint(alpha: CGFloat(min(max(alpha, 0), 1)))
      }

      Prop("colorScheme") { (view: XyneBlurSurfaceView, scheme: String?) in
        view.setColorScheme(scheme)
      }
    }
  }
}
