import WidgetKit
import SwiftUI

@main
struct RecordingWidgetBundle: WidgetBundle {
  var body: some Widget {
    RecordingWidget()
    RecordingLiveActivityWidget()
  }
}
