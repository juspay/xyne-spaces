import SwiftUI
import WidgetKit

struct RecordingWidget: Widget {
  let kind: String = "RecordingWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: RecordingTimelineProvider()) { entry in
      RecordingWidgetView(entry: entry)
    }
    .configurationDisplayName("Recording")
    .description("Start or stop a recording.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
