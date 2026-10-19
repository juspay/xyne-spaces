import ActivityKit
import SwiftUI
import WidgetKit

private let laBrandBlue = Color(red: 0x02 / 255, green: 0x3c / 255, blue: 0x69 / 255)
private let laBrandRed = Color(red: 0xE5 / 255, green: 0x39 / 255, blue: 0x35 / 255)

@ViewBuilder
private func stopControl<Label: View>(@ViewBuilder label: () -> Label) -> some View {
  // Interactive AppIntent buttons inside a Live Activity are an iOS 17+
  // capability, same restriction as the home screen widget — iOS 16.1–16.x
  // fall back to a plain deep-link Link, which foregrounds the app.
  if #available(iOS 17.0, *) {
    Button(intent: StopRecordingIntent(), label: label)
  } else {
    Link(destination: URL(string: "xyne-spaces://recordings?action=stop")!, label: label)
  }
}

/// Lock Screen / Dynamic Island presentation for an in-progress recording.
struct RecordingLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLiveActivityLockScreenView(startTime: context.state.startTime)
        .activityBackgroundTint(laBrandBlue)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "mic.fill")
            .foregroundColor(.white)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
            .monospacedDigit()
            .foregroundColor(.white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          stopControl {
            Text("Stop Recording")
              .font(.system(size: 14, weight: .bold))
              .frame(maxWidth: .infinity)
              .padding(.vertical, 6)
          }
          .tint(laBrandRed)
        }
      } compactLeading: {
        Image(systemName: "mic.fill")
          .foregroundColor(laBrandRed)
      } compactTrailing: {
        Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
          .monospacedDigit()
          .frame(width: 44)
      } minimal: {
        Image(systemName: "mic.fill")
          .foregroundColor(laBrandRed)
      }
      .widgetURL(URL(string: "xyne-spaces://recordings"))
      .keylineTint(laBrandRed)
    }
  }
}

private struct RecordingLiveActivityLockScreenView: View {
  let startTime: Date

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: "mic.fill")
        .font(.system(size: 20))
        .foregroundColor(.white)

      VStack(alignment: .leading, spacing: 2) {
        Text("Recording in progress")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(.white)
        Text(timerInterval: startTime...Date.distantFuture, countsDown: false)
          .font(.system(size: 12))
          .foregroundColor(.white.opacity(0.7))
          .monospacedDigit()
      }

      Spacer(minLength: 8)

      stopControl {
        Text("Stop")
          .font(.system(size: 13, weight: .bold))
          .foregroundColor(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .background(laBrandRed)
          .clipShape(Capsule())
      }
    }
    .padding(16)
  }
}
