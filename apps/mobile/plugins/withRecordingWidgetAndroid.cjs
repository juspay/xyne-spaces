const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

// ─── Recording home-screen widget (Android) ────────────────────────────────
//
// Classic AppWidgetProvider + RemoteViews (not Jetpack Glance/Compose): this
// project has no existing Compose setup and no pinned Kotlin version, so
// adding a Compose-compiler dependency purely for one widget would be a real
// build-break risk. RemoteViews is still the mechanism Glance itself compiles
// down to, and is what most production widgets (including Google's own) ship.
//
// The Start/Stop buttons never record anything themselves — recording is a
// LiveKit/WebRTC session owned by the RN JS engine. Start always foregrounds
// the app via the `xyne-spaces://recordings?action=start` deep link (JS isn't
// running yet, so there's no way around this). Stop does NOT need to
// foreground: VoIPForegroundService is already running as a real foreground
// service for the whole duration of any active recording (see
// recordingStore.ts's `voipForegroundServiceModule.start()` call), so the app
// process is guaranteed alive — the Stop button broadcasts straight to this
// widget's own receiver, which emits directly to the JS bridge. A deep-link
// fallback only fires if that bridge turns out to be unreachable.

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ─── Kotlin sources ─────────────────────────────────────────────────────────

function buildRecordingWidgetStateSource(androidPackage) {
  return `package ${androidPackage}

import android.content.Context

/**
 * Plain (non-React) holder for the widget-visible recording state, backed by
 * SharedPreferences so it survives process death and can be read from the
 * AppWidgetProvider without a live React bridge.
 */
object RecordingWidgetState {
  private const val PREFS_NAME = "recording_widget_state"
  private const val KEY_IS_RECORDING = "is_recording"
  private const val KEY_START_TIME_MS = "start_time_ms"
  private const val KEY_EXTERNAL_ID = "external_id"
  private const val KEY_HAS_ERROR = "has_error"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun publish(
    context: Context,
    isRecording: Boolean,
    startTimeMs: Long?,
    externalId: String?,
    hasError: Boolean = false,
  ) {
    prefs(context)
      .edit()
      .putBoolean(KEY_IS_RECORDING, isRecording)
      .putLong(KEY_START_TIME_MS, startTimeMs ?: 0L)
      .putString(KEY_EXTERNAL_ID, externalId)
      .putBoolean(KEY_HAS_ERROR, hasError)
      .apply()
    RecordingWidgetProvider.updateAllWidgets(context)
  }

  /** Safe to call unconditionally (e.g. from a shared foreground-service teardown path) —
   *  idempotent no-op when a recording wasn't in progress. */
  fun clear(context: Context) = publish(context, false, null, null)

  fun isRecording(context: Context): Boolean = prefs(context).getBoolean(KEY_IS_RECORDING, false)

  fun startTimeMs(context: Context): Long = prefs(context).getLong(KEY_START_TIME_MS, 0L)

  fun hasError(context: Context): Boolean = prefs(context).getBoolean(KEY_HAS_ERROR, false)
}
`;
}

function buildRecordingWidgetProviderSource(androidPackage) {
  return `package ${androidPackage}

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import com.facebook.react.modules.core.DeviceEventManagerModule

class RecordingWidgetProvider : AppWidgetProvider() {

  companion object {
    private const val TAG = "RecordingWidgetProvider"
    const val ACTION_STOP_RECORDING = "${androidPackage}.RECORDING_WIDGET_STOP"
    private const val START_REQUEST_CODE = 9910
    private const val STOP_REQUEST_CODE = 9911
    private const val ERROR_REQUEST_CODE = 9912

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, RecordingWidgetProvider::class.java))
      for (id in ids) {
        updateWidget(context, manager, id)
      }
    }

    // Below this measured width (dp ≈ under 3 launcher cells) the row layout
    // gets cramped — switch to the vertical compact layout instead.
    private const val COMPACT_MAX_WIDTH_DP = 180

    private fun layoutFor(context: Context, manager: AppWidgetManager, appWidgetId: Int): Int {
      val minWidthDp = manager.getAppWidgetOptions(appWidgetId)
        ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
      return if (minWidthDp in 1 until COMPACT_MAX_WIDTH_DP) {
        R.layout.recording_widget_compact
      } else {
        // 0 = options not yet reported by the launcher — default to the wide
        // layout, matching the provider-info default size (3x1).
        R.layout.recording_widget
      }
    }

    private fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
      val views = RemoteViews(context.packageName, layoutFor(context, manager, appWidgetId))
      val isRecording = RecordingWidgetState.isRecording(context)
      val hasError = RecordingWidgetState.hasError(context)

      views.setViewVisibility(R.id.widget_idle_group, View.GONE)
      views.setViewVisibility(R.id.widget_recording_group, View.GONE)
      views.setViewVisibility(R.id.widget_error_group, View.GONE)

      when {
        isRecording -> {
          views.setViewVisibility(R.id.widget_recording_group, View.VISIBLE)

          val startTimeMs = RecordingWidgetState.startTimeMs(context)
          val chronometerBase = SystemClock.elapsedRealtime() + (startTimeMs - System.currentTimeMillis())
          views.setChronometer(R.id.widget_chronometer, chronometerBase, null, true)

          // Anywhere outside the stop button opens the recordings screen with
          // the in-progress recording; only the stop button itself stops. The
          // child button's PendingIntent takes precedence over the group's.
          views.setOnClickPendingIntent(R.id.widget_recording_group, openAppPendingIntent(context))

          val stopIntent = Intent(context, RecordingWidgetProvider::class.java).apply {
            action = ACTION_STOP_RECORDING
          }
          val stopPendingIntent = PendingIntent.getBroadcast(
            context,
            STOP_REQUEST_CODE,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
          )
          views.setOnClickPendingIntent(R.id.widget_stop_button, stopPendingIntent)
        }
        hasError -> {
          views.setViewVisibility(R.id.widget_error_group, View.VISIBLE)
          views.setOnClickPendingIntent(R.id.widget_error_group, openAppPendingIntent(context))
        }
        else -> {
          views.setViewVisibility(R.id.widget_idle_group, View.VISIBLE)
          views.setChronometer(R.id.widget_chronometer, SystemClock.elapsedRealtime(), null, false)

          val startIntent = Intent(Intent.ACTION_VIEW, Uri.parse("xyne-spaces://recordings?action=start")).apply {
            setPackage(context.packageName)
          }
          val startPendingIntent = PendingIntent.getActivity(
            context,
            START_REQUEST_CODE,
            startIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
          )
          views.setOnClickPendingIntent(R.id.widget_idle_group, startPendingIntent)
        }
      }

      manager.updateAppWidget(appWidgetId, views)
    }

    /** Open the recordings screen with no auto-start/stop action — the tap
     *  target for the error state and for the recording state's non-button
     *  area (the screen shows the in-progress recording). */
    private fun openAppPendingIntent(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("xyne-spaces://recordings")).apply {
        setPackage(context.packageName)
      }
      return PendingIntent.getActivity(
        context,
        ERROR_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) {
      updateWidget(context, appWidgetManager, id)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?,
  ) {
    // Fired when the user resizes the widget — re-render so the compact/wide
    // layout tracks the new size.
    updateWidget(context, appWidgetManager, appWidgetId)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != ACTION_STOP_RECORDING) return

    // "widget" (default) or "notification" — the foreground-service
    // notification's stop button reuses this same broadcast path.
    val source = intent.getStringExtra("source") ?: "widget"
    Log.d(TAG, "Stop action received (source=" + source + ")")
    val delivered = runCatching {
      val reactContext = RecordingWidgetModule.reactContext ?: return@runCatching false
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("RECORDING_WIDGET_STOP", source)
      true
    }.getOrElse { e ->
      Log.e(TAG, "Failed to emit RECORDING_WIDGET_STOP to JS bridge", e)
      false
    }

    if (!delivered) {
      // Defensive fallback: the JS bridge wasn't reachable (app process not
      // alive despite the foreground service) — foreground the app instead so
      // the user can still stop the recording from there.
      Log.w(TAG, "JS bridge unreachable, falling back to deep link")
      val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse("xyne-spaces://recordings?action=stop")).apply {
        setPackage(context.packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(fallbackIntent)
    }
  }
}
`;
}

function buildRecordingWidgetModuleSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.lang.ref.WeakReference

class RecordingWidgetModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    _reactContextRef = WeakReference(reactContext)
  }

  companion object {
    @Volatile
    private var _reactContextRef: WeakReference<ReactApplicationContext>? = null

    val reactContext: ReactApplicationContext?
      get() = _reactContextRef?.get()
  }

  override fun getName(): String = "RecordingWidgetModule"

  @ReactMethod
  fun publishState(
    isRecording: Boolean,
    startTimeMs: Double,
    externalId: String?,
    hasError: Boolean,
    promise: Promise,
  ) {
    try {
      RecordingWidgetState.publish(
        reactApplicationContext,
        isRecording,
        if (startTimeMs > 0) startTimeMs.toLong() else null,
        externalId,
        hasError,
      )
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("RECORDING_WIDGET_ERROR", e.message, e)
    }
  }

  // Required stubs for RCTEventEmitter-style JS listeners (events are emitted
  // via the global DeviceEventEmitter, same convention as VoIPForegroundServiceModule).
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
`;
}

function buildRecordingWidgetPackageSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class RecordingWidgetPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(RecordingWidgetModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

// ─── Resources ──────────────────────────────────────────────────────────────

// Wide layout — 3+ cells. Icon chip + title/hint when idle; REC dot + large
// chronometer + stop button while recording.
function buildRecordingWidgetLayoutXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:background="@drawable/bg_recording_widget"
  android:padding="14dp">

  <!-- Idle state: tap anywhere to start a recording -->
  <LinearLayout
    android:id="@+id/widget_idle_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal"
    android:gravity="center_vertical">

    <FrameLayout
      android:layout_width="46dp"
      android:layout_height="46dp"
      android:background="@drawable/bg_recording_widget_icon_chip">

      <ImageView
        android:layout_width="22dp"
        android:layout_height="22dp"
        android:layout_gravity="center"
        android:src="@drawable/ic_recording_widget_mic"
        android:contentDescription="@null" />
    </FrameLayout>

    <LinearLayout
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:layout_weight="1"
      android:layout_marginStart="12dp"
      android:orientation="vertical">

      <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="@string/recording_widget_start"
        android:textColor="#FFFFFF"
        android:textSize="15sp"
        android:textStyle="bold" />

      <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:text="@string/recording_widget_start_hint"
        android:textColor="#A6FFFFFF"
        android:textSize="11sp"
        android:maxLines="1"
        android:ellipsize="end" />
    </LinearLayout>
  </LinearLayout>

  <!-- Recording state: live elapsed timer + Stop button -->
  <LinearLayout
    android:id="@+id/widget_recording_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:visibility="gone">

    <LinearLayout
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:layout_weight="1"
      android:orientation="vertical">

      <LinearLayout
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical">

        <!-- ImageView, not a plain View: RemoteViews only inflates a fixed
             whitelist of view classes, and android.view.View is not on it —
             one illegal element anywhere in the file makes the launcher show
             "An error occurred when loading widget" for the whole widget. -->
        <ImageView
          android:layout_width="8dp"
          android:layout_height="8dp"
          android:src="@drawable/bg_recording_widget_rec_dot"
          android:contentDescription="@null" />

        <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_marginStart="6dp"
          android:text="@string/recording_widget_recording"
          android:textColor="#BFFFFFFF"
          android:textSize="11sp"
          android:textStyle="bold" />
      </LinearLayout>

      <Chronometer
        android:id="@+id/widget_chronometer"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:textColor="#FFFFFF"
        android:textSize="24sp"
        android:textStyle="bold"
        android:fontFamily="sans-serif-medium" />
    </LinearLayout>

    <ImageButton
      android:id="@+id/widget_stop_button"
      android:layout_width="44dp"
      android:layout_height="44dp"
      android:background="@drawable/bg_recording_widget_stop_button"
      android:src="@drawable/ic_recording_widget_stop"
      android:scaleType="centerInside"
      android:padding="12dp"
      android:contentDescription="@string/recording_widget_stop_description" />
  </LinearLayout>

  <!-- Error state: recording failed to start/continue — auto-clears a few
       seconds after JS publishes it (see recordingStore.ts's 'error' case) -->
  <LinearLayout
    android:id="@+id/widget_error_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:visibility="gone">

    <ImageView
      android:layout_width="24dp"
      android:layout_height="24dp"
      android:src="@drawable/ic_recording_widget_error"
      android:contentDescription="@null" />

    <TextView
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:layout_weight="1"
      android:layout_marginStart="10dp"
      android:text="@string/recording_widget_error"
      android:textColor="#FFFFFF"
      android:textSize="13sp"
      android:textStyle="bold" />
  </LinearLayout>
</FrameLayout>
`;
}

// Compact layout — 2-cell widths. Vertical, centered; same view ids as the
// wide layout so RecordingWidgetProvider drives both identically.
function buildRecordingWidgetCompactLayoutXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:background="@drawable/bg_recording_widget"
  android:padding="10dp">

  <!-- Idle state -->
  <LinearLayout
    android:id="@+id/widget_idle_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center">

    <FrameLayout
      android:layout_width="42dp"
      android:layout_height="42dp"
      android:background="@drawable/bg_recording_widget_icon_chip">

      <ImageView
        android:layout_width="20dp"
        android:layout_height="20dp"
        android:layout_gravity="center"
        android:src="@drawable/ic_recording_widget_mic"
        android:contentDescription="@null" />
    </FrameLayout>

    <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="6dp"
      android:text="@string/recording_widget_start"
      android:textColor="#FFFFFF"
      android:textSize="12sp"
      android:textStyle="bold"
      android:gravity="center"
      android:maxLines="2" />
  </LinearLayout>

  <!-- Recording state -->
  <LinearLayout
    android:id="@+id/widget_recording_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:visibility="gone">

    <LinearLayout
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:orientation="horizontal"
      android:gravity="center_vertical">

      <!-- ImageView, not a plain View — see the note in recording_widget.xml. -->
      <ImageView
        android:layout_width="7dp"
        android:layout_height="7dp"
        android:src="@drawable/bg_recording_widget_rec_dot"
        android:contentDescription="@null" />

      <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginStart="5dp"
        android:text="@string/recording_widget_rec"
        android:textColor="#BFFFFFFF"
        android:textSize="10sp"
        android:textStyle="bold" />
    </LinearLayout>

    <Chronometer
      android:id="@+id/widget_chronometer"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="2dp"
      android:textColor="#FFFFFF"
      android:textSize="19sp"
      android:textStyle="bold"
      android:fontFamily="sans-serif-medium" />

    <ImageButton
      android:id="@+id/widget_stop_button"
      android:layout_width="36dp"
      android:layout_height="36dp"
      android:layout_marginTop="6dp"
      android:background="@drawable/bg_recording_widget_stop_button"
      android:src="@drawable/ic_recording_widget_stop"
      android:scaleType="centerInside"
      android:padding="10dp"
      android:contentDescription="@string/recording_widget_stop_description" />
  </LinearLayout>

  <!-- Error state -->
  <LinearLayout
    android:id="@+id/widget_error_group"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:visibility="gone">

    <ImageView
      android:layout_width="28dp"
      android:layout_height="28dp"
      android:src="@drawable/ic_recording_widget_error"
      android:contentDescription="@null" />

    <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="6dp"
      android:text="@string/recording_widget_error_short"
      android:textColor="#FFFFFF"
      android:textSize="11sp"
      android:textStyle="bold"
      android:gravity="center"
      android:maxLines="2" />
  </LinearLayout>
</FrameLayout>
`;
}

function buildRecordingWidgetInfoXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="180dp"
  android:minHeight="40dp"
  android:minResizeWidth="110dp"
  android:minResizeHeight="40dp"
  android:targetCellWidth="3"
  android:targetCellHeight="1"
  android:updatePeriodMillis="0"
  android:initialLayout="@layout/recording_widget"
  android:previewImage="@mipmap/ic_launcher"
  android:resizeMode="horizontal|vertical"
  android:widgetCategory="home_screen" />
`;
}

// Diagonal brand gradient (colorPrimary #023c69 family) — mirrors the
// SwiftUI LinearGradient in RecordingWidgetView.swift so both platforms'
// widgets read as one design.
function buildBgRecordingWidgetDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="rectangle">
  <gradient
    android:angle="315"
    android:startColor="#0D4F86"
    android:endColor="#01203A" />
  <corners android:radius="20dp" />
</shape>
`;
}

// Soft translucent chip behind the mic glyph — the widget's idle identity.
function buildBgRecordingWidgetIconChipDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="oval">
  <solid android:color="#26FFFFFF" />
</shape>
`;
}

// Small red dot — the "live" indicator while recording.
function buildBgRecordingWidgetRecDotDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="oval">
  <solid android:color="#FF5252" />
</shape>
`;
}

function buildBgRecordingWidgetStopButtonDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="oval">
  <solid android:color="@color/colorEndCall" />
</shape>
`;
}

// Material "mic" glyph — matches the existing NSMicrophoneUsageDescription-era
// microphone iconography used elsewhere in the app.
function buildIcRecordingWidgetMicDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <path
    android:fillColor="#FFFFFF"
    android:pathData="M12,14c1.66,0 3,-1.34 3,-3V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6C9,12.66 10.34,14 12,14z M17,11c0,2.76 -2.24,5 -5,5s-5,-2.24 -5,-5H5c0,3.53 2.61,6.43 6,6.92V21h2v-3.08c3.39,-0.49 6,-3.39 6,-6.92H17z"/>
</vector>
`;
}

// Material "error" glyph — filled circle with exclamation mark.
function buildIcRecordingWidgetErrorDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <path
    android:fillColor="#FFFFFF"
    android:pathData="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM13,17h-2v-2h2v2zM13,13h-2L11,7h2v6z"/>
</vector>
`;
}

function buildIcRecordingWidgetStopDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <path
    android:fillColor="#FFFFFF"
    android:pathData="M6,6h12v12H6z"/>
</vector>
`;
}

// ─── Config plugin steps ────────────────────────────────────────────────────

const withRecordingWidgetFiles = config =>
  withDangerousMod(config, [
    'android',
    modConfig => {
      const androidPackage = modConfig?.android?.package;
      if (!androidPackage) return modConfig;

      const javaDir = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        toPackagePath(androidPackage),
      );
      ensureDirectory(javaDir);

      fs.writeFileSync(
        path.join(javaDir, 'RecordingWidgetState.kt'),
        buildRecordingWidgetStateSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'RecordingWidgetProvider.kt'),
        buildRecordingWidgetProviderSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'RecordingWidgetModule.kt'),
        buildRecordingWidgetModuleSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'RecordingWidgetPackage.kt'),
        buildRecordingWidgetPackageSource(androidPackage),
      );

      const resDir = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
      );

      const layoutDir = path.join(resDir, 'layout');
      ensureDirectory(layoutDir);
      fs.writeFileSync(
        path.join(layoutDir, 'recording_widget.xml'),
        buildRecordingWidgetLayoutXml(),
      );
      fs.writeFileSync(
        path.join(layoutDir, 'recording_widget_compact.xml'),
        buildRecordingWidgetCompactLayoutXml(),
      );

      const xmlDir = path.join(resDir, 'xml');
      ensureDirectory(xmlDir);
      fs.writeFileSync(
        path.join(xmlDir, 'recording_widget_info.xml'),
        buildRecordingWidgetInfoXml(),
      );

      const drawableDir = path.join(resDir, 'drawable');
      ensureDirectory(drawableDir);
      fs.writeFileSync(
        path.join(drawableDir, 'bg_recording_widget.xml'),
        buildBgRecordingWidgetDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'bg_recording_widget_stop_button.xml'),
        buildBgRecordingWidgetStopButtonDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'ic_recording_widget_mic.xml'),
        buildIcRecordingWidgetMicDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'ic_recording_widget_stop.xml'),
        buildIcRecordingWidgetStopDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'ic_recording_widget_error.xml'),
        buildIcRecordingWidgetErrorDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'bg_recording_widget_icon_chip.xml'),
        buildBgRecordingWidgetIconChipDrawable(),
      );
      fs.writeFileSync(
        path.join(drawableDir, 'bg_recording_widget_rec_dot.xml'),
        buildBgRecordingWidgetRecDotDrawable(),
      );

      const valuesDir = path.join(resDir, 'values');
      ensureDirectory(valuesDir);
      const stringsPath = path.join(valuesDir, 'strings.xml');
      const widgetStrings = [
        ['recording_widget_start', 'Start Recording'],
        ['recording_widget_start_hint', 'Capture audio with live transcription'],
        ['recording_widget_recording', 'Recording'],
        ['recording_widget_rec', 'REC'],
        ['recording_widget_stop_description', 'Stop recording'],
        ['recording_widget_error', 'Recording failed — tap to open'],
        ['recording_widget_error_short', 'Recording failed'],
      ];
      let stringsXml = readFileIfExists(stringsPath);
      if (stringsXml !== null) {
        for (const [name, value] of widgetStrings) {
          if (!stringsXml.includes(`name="${name}"`)) {
            stringsXml = stringsXml.replace(
              '</resources>',
              `  <string name="${name}">${value}</string>\n</resources>`,
            );
          }
        }
        fs.writeFileSync(stringsPath, stringsXml);
      } else {
        const body = widgetStrings
          .map(([name, value]) => `  <string name="${name}">${value}</string>`)
          .join('\n');
        fs.writeFileSync(stringsPath, `<resources>\n${body}\n</resources>\n`);
      }

      return modConfig;
    },
  ]);

const withRecordingWidgetManifest = config =>
  withDangerousMod(config, [
    'android',
    modConfig => {
      const manifestPath = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'AndroidManifest.xml',
      );
      let contents = readFileIfExists(manifestPath);
      if (contents === null) return modConfig;

      const receiverDecl = `    <receiver
      android:name=".RecordingWidgetProvider"
      android:exported="false"
      android:label="Recording">
      <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
      </intent-filter>
      <meta-data
        android:name="android.appwidget.provider"
        android:resource="@xml/recording_widget_info"/>
    </receiver>`;
      if (!contents.includes('RecordingWidgetProvider')) {
        contents = contents.replace('</application>', `${receiverDecl}\n  </application>`);
      }

      fs.writeFileSync(manifestPath, contents);
      return modConfig;
    },
  ]);

const withRecordingWidgetMainApplication = config =>
  withMainApplication(config, modConfig => {
    const androidPackage = modConfig?.android?.package;
    if (!androidPackage) return modConfig;

    let contents = modConfig.modResults.contents;

    const importLine = `import ${androidPackage}.RecordingWidgetPackage`;
    if (!contents.includes(importLine)) {
      contents = contents.replace(/(package .*\n)/, `$1\n${importLine}\n`);
    }

    if (!contents.includes('RecordingWidgetPackage()')) {
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply \{[\s\S]*?)(\/\/ add\(MyReactNativePackage\(\)\))/,
        `$1              add(RecordingWidgetPackage())\n              $2`,
      );
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });

module.exports = config => {
  config = withRecordingWidgetFiles(config);
  config = withRecordingWidgetManifest(config);
  config = withRecordingWidgetMainApplication(config);
  return config;
};
