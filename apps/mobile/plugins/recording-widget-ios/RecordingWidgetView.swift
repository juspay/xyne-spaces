import SwiftUI
import WidgetKit

private let brandRed = Color(red: 0xE5 / 255, green: 0x39 / 255, blue: 0x35 / 255)
private let recDotRed = Color(red: 0xFF / 255, green: 0x52 / 255, blue: 0x52 / 255)

/// Diagonal brand gradient (colorPrimary #023c69 family) — mirrors
/// bg_recording_widget.xml on Android so both widgets read as one design.
private let widgetGradient = LinearGradient(
  colors: [
    Color(red: 0x0D / 255, green: 0x4F / 255, blue: 0x86 / 255),
    Color(red: 0x01 / 255, green: 0x20 / 255, blue: 0x3A / 255),
  ],
  startPoint: .topLeading,
  endPoint: .bottomTrailing
)

private extension View {
  /// iOS 17+ requires `.containerBackground(for: .widget)` instead of a plain
  /// `.background()` on the root view (a plain background triggers a "widget
  /// does not use containerBackground" system warning); iOS 16.x has no
  /// `.containerBackground` API at all. Deployment target stays 16.4, so both
  /// paths are needed.
  @ViewBuilder
  func widgetBackground<S: ShapeStyle>(_ style: S) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(style, for: .widget)
    } else {
      background(style)
    }
  }
}

/// Mic glyph inside a soft translucent chip — the widget's idle identity.
private struct MicChip: View {
  var diameter: CGFloat

  var body: some View {
    ZStack {
      Circle()
        .fill(Color.white.opacity(0.15))
        .frame(width: diameter, height: diameter)
      Image(systemName: "mic.fill")
        .font(.system(size: diameter * 0.42, weight: .semibold))
        .foregroundColor(.white)
    }
  }
}

/// Small red dot + label — the "live" indicator while recording.
private struct RecIndicator: View {
  var label: String

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(recDotRed)
        .frame(width: 8, height: 8)
      Text(label)
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(.white.opacity(0.75))
    }
  }
}

private struct StopBadge: View {
  var diameter: CGFloat

  var body: some View {
    ZStack {
      Circle()
        .fill(brandRed)
        .frame(width: diameter, height: diameter)
      Image(systemName: "stop.fill")
        .font(.system(size: diameter * 0.38, weight: .bold))
        .foregroundColor(.white)
    }
  }
}

struct RecordingWidgetView: View {
  var entry: RecordingWidgetEntry

  @Environment(\.widgetFamily) private var family

  /// Whole-widget tap-through, applied via `.widgetURL` — the only tap
  /// mechanism `systemSmall` supports (Link is documented not to work there),
  /// and the fallback for any area a Button doesn't cover on larger families.
  /// Every state opens the recordings module; idle additionally auto-starts
  /// (Start must always foreground the app — no JS is running yet to own the
  /// LiveKit connection, and openAppWhenRun is not honored for widget-
  /// extension intents, so a deep link is the one reliable mechanism).
  private var tapThroughURL: URL {
    if entry.isRecording || entry.hasError {
      return URL(string: "xyne-spaces://recordings")!
    }
    return URL(string: "xyne-spaces://recordings?action=start")!
  }

  var body: some View {
    Group {
      if entry.isRecording, let startTime = entry.startTime {
        recordingLabel(startTime: startTime)
      } else if entry.hasError {
        errorLabel
      } else {
        idleLabel
      }
    }
    .widgetBackground(widgetGradient)
    .widgetURL(tapThroughURL)
  }

  /// The one control that stops WITHOUT opening the app: iOS 17+ AppIntent
  /// (see StopRecordingIntent). iOS 16.x medium falls back to a stop deep
  /// link; iOS 16.x small has no per-element tap targets at all, so the badge
  /// joins the whole-widget URL (open the module, stop from there).
  @ViewBuilder
  private func stopControl(diameter: CGFloat) -> some View {
    if #available(iOS 17.0, *) {
      Button(intent: StopRecordingIntent()) { StopBadge(diameter: diameter) }
        .buttonStyle(.plain)
    } else if family != .systemSmall {
      Link(destination: URL(string: "xyne-spaces://recordings?action=stop")!) {
        StopBadge(diameter: diameter)
      }
    } else {
      StopBadge(diameter: diameter)
    }
  }

  // ── Idle ──────────────────────────────────────────────────────────────────

  @ViewBuilder
  private var idleLabel: some View {
    switch family {
    case .systemSmall:
      VStack(spacing: 10) {
        MicChip(diameter: 52)
        Text("Start\nRecording")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
          .multilineTextAlignment(.center)
          .lineSpacing(1)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    default:
      HStack(spacing: 14) {
        MicChip(diameter: 54)
        VStack(alignment: .leading, spacing: 3) {
          Text("Start Recording")
            .font(.system(size: 16, weight: .bold))
            .foregroundColor(.white)
          Text("Capture audio with live transcription")
            .font(.system(size: 12))
            .foregroundColor(.white.opacity(0.65))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        Spacer(minLength: 0)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  @ViewBuilder
  private func recordingLabel(startTime: Date) -> some View {
    switch family {
    case .systemSmall:
      VStack(spacing: 8) {
        RecIndicator(label: "REC")
        Text(timerInterval: startTime...Date.distantFuture, countsDown: false)
          .font(.system(size: 22, weight: .bold))
          .foregroundColor(.white)
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .multilineTextAlignment(.center)
        stopControl(diameter: 38)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    default:
      HStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 5) {
          RecIndicator(label: "Recording")
          Text(timerInterval: startTime...Date.distantFuture, countsDown: false)
            .font(.system(size: 30, weight: .bold))
            .foregroundColor(.white)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        Spacer(minLength: 0)
        stopControl(diameter: 46)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  @ViewBuilder
  private var errorLabel: some View {
    switch family {
    case .systemSmall:
      VStack(spacing: 8) {
        Image(systemName: "exclamationmark.circle.fill")
          .font(.system(size: 30))
          .foregroundColor(.white)
        Text("Recording failed")
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(.white)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    default:
      HStack(spacing: 12) {
        Image(systemName: "exclamationmark.circle.fill")
          .font(.system(size: 24))
          .foregroundColor(.white)
        Text("Recording failed — tap to open")
          .font(.system(size: 13, weight: .bold))
          .foregroundColor(.white)
        Spacer(minLength: 0)
      }
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
  }
}
