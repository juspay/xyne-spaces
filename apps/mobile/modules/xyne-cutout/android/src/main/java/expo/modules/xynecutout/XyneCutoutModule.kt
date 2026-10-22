package expo.modules.xynecutout

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** One hole, in dp of the view's own coordinates, as React hands lengths over. */
class CutoutHole : Record {
  @Field val x: Float = 0f
  @Field val y: Float = 0f
  @Field val width: Float = 0f
  @Field val height: Float = 0f
  @Field val radius: Float = 0f
}

class XyneCutoutModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("XyneCutout")

    View(XyneCutoutView::class) {
      Name("XyneCutoutView")

      Prop("holes") { view: XyneCutoutView, holes: List<CutoutHole>? ->
        view.setHoles(holes.orEmpty(), view.resources.displayMetrics.density)
      }
    }
  }
}
