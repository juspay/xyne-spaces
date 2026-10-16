const {
  createRunOncePlugin,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

// ─── VoIP Foreground Service (ongoing call notification) ─────────────────────

function buildVoIPForegroundServiceSource(androidPackage) {
  return `package ${androidPackage}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.modules.core.DeviceEventManagerModule

class VoIPForegroundService : Service() {

  private val handler = Handler(Looper.getMainLooper())
  private var startedAt: Long = 0L
  private var notificationManager: NotificationManager? = null

  companion object {
    const val ACTION_START = "${androidPackage}.START_VOIP_SERVICE"
    const val ACTION_STOP = "${androidPackage}.STOP_VOIP_SERVICE"
    const val ACTION_END_CALL = "${androidPackage}.END_CALL"
    const val EXTRA_STARTED_AT = "startedAt"
    const val EXTRA_MODE = "mode"
    const val MODE_CALL = "call"
    const val MODE_RECORDING = "recording"
    const val NOTIFICATION_ID = 9901
    private const val CHANNEL_ID = "ongoing_calls"
    private const val RECORDING_CHANNEL_ID = "ongoing_recordings"
    private const val UPDATE_INTERVAL_MS = 1000L
    // Shared by every in-call native log so \`adb logcat -s XCALL\` shows the whole call.
    const val LOG_TAG = "XCALL"

    // Android 14+ refuses a microphone-type foreground service without RECORD_AUDIO, so a call
    // joined without mic access runs as a phoneCall service; it's upgraded when the user unmutes.
    fun foregroundServiceType(context: android.content.Context, mode: String): Int {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
      val micType = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (mode == MODE_RECORDING) return micType
      val hasMic = context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED
      val phoneCallType = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      return if (hasMic) micType or phoneCallType else phoneCallType
    }

    fun describeServiceType(type: Int): String {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "none"
      val names = mutableListOf<String>()
      if ((type and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) != 0) names.add("microphone")
      if ((type and android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL) != 0) names.add("phoneCall")
      return if (names.isEmpty()) "none" else names.joinToString("|")
    }
  }

  // This service keeps the microphone alive for both LiveKit surfaces: real
  // calls (CallRuntimeNativeService) and headless recordings (recordingStore).
  // The mode picks the notification's copy, icon, channel, and — critically —
  // which stop path the action button fires: END_CALL is only handled by the
  // call runtime, so a recording's button must broadcast the widget's
  // RECORDING_WIDGET_STOP path instead.
  private var mode: String = MODE_CALL

  private val ticker = object : Runnable {
    override fun run() {
      updateNotification()
      handler.postDelayed(this, UPDATE_INTERVAL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        startedAt = intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis())
        mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_CALL
        val notification = buildNotification()
        val type = foregroundServiceType(this, mode)
        val typeName = describeServiceType(type)
        Log.i(LOG_TAG, "VoIPForegroundService start mode=$mode type=$typeName")
        try {
          ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        } catch (e: Exception) {
          Log.e(LOG_TAG, "VoIPForegroundService startForeground failed mode=$mode", e)
          throw e
        }
        // START is re-sent to upgrade the type once mic access is granted mid-call.
        handler.removeCallbacks(ticker)
        handler.post(ticker)
      }
      ACTION_STOP -> {
        Log.i(LOG_TAG, "VoIPForegroundService stop mode=$mode")
        removeOngoingCallNotification()
        stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    Log.i(LOG_TAG, "VoIPForegroundService task removed (app swiped away) mode=$mode, ending call")
    // Swiping Lotus from Recents ends the local call and must never leave the
    // foreground-service notification behind.
    runCatching {
      VoIPForegroundServiceModule.reactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("VOIP_END_CALL", null)
    }
    // This service is also used for headless recordings — clear the recording
    // widget's state so a force-quit doesn't leave it stuck showing
    // "recording" indefinitely. No-op if this session wasn't a recording.
    runCatching { RecordingWidgetState.clear(applicationContext) }
    removeOngoingCallNotification()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    removeOngoingCallNotification()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun removeOngoingCallNotification() {
    handler.removeCallbacks(ticker)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    notificationManager?.cancel(NOTIFICATION_ID)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val callChannel = NotificationChannel(
        CHANNEL_ID,
        "Ongoing Calls",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Shows ongoing call status"
        setSound(null, null)
        enableVibration(false)
      }
      val recordingChannel = NotificationChannel(
        RECORDING_CHANNEL_ID,
        "Ongoing Recordings",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Shows ongoing recording status"
        setSound(null, null)
        enableVibration(false)
      }
      notificationManager?.createNotificationChannel(callChannel)
      notificationManager?.createNotificationChannel(recordingChannel)
    }
  }

  private fun elapsedFormatted(): String {
    val elapsed = (System.currentTimeMillis() - startedAt) / 1000L
    val mins = elapsed / 60
    val secs = elapsed % 60
    return String.format("%02d:%02d", mins, secs)
  }

  private fun buildNotification(): Notification {
    val isRecording = mode == MODE_RECORDING

    // Action button. END_CALL is only consumed by the call runtime
    // (CallRuntimeNativeService's VOIP_END_CALL listener), so a recording's
    // stop button must instead broadcast the same RECORDING_WIDGET_STOP path
    // the home-screen widget uses — recordingStore's listener stops the room.
    val stopIntent = if (isRecording) {
      Intent(this, RecordingWidgetProvider::class.java).apply {
        action = RecordingWidgetProvider.ACTION_STOP_RECORDING
        putExtra("source", "notification")
      }
    } else {
      Intent(this, VoIPCallActionReceiver::class.java).apply {
        action = ACTION_END_CALL
      }
    }
    val stopPendingIntent = PendingIntent.getBroadcast(
      this,
      // Distinct request code from the widget's stop PendingIntent (9911):
      // same component+action with FLAG_UPDATE_CURRENT would otherwise share
      // identity and clobber each other's "source" extra.
      if (isRecording) 9903 else 0,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    // Tap notification body → open the app (recordings land on the
    // recordings screen via the same deep link the widget uses).
    val contentIntent = if (isRecording) {
      val recordingsIntent = Intent(Intent.ACTION_VIEW, Uri.parse("xyne-spaces://recordings")).apply {
        setPackage(packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      PendingIntent.getActivity(
        this,
        9904,
        recordingsIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    } else {
      val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      PendingIntent.getActivity(
        this,
        9902,
        launchIntent ?: Intent(),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val elapsed = elapsedFormatted()
    val title = if (isRecording) "Recording in progress" else "Call in progress"
    val subtitle = if (isRecording) {
      "$elapsed  ·  Tap to open recordings"
    } else {
      "$elapsed  ·  Tap to return to call"
    }

    val remoteViews = RemoteViews(packageName, R.layout.notification_ongoing_call).apply {
      setTextViewText(R.id.notif_title, title)
      setTextViewText(R.id.notif_subtitle, subtitle)
      // Force white text so it's readable on any notification background
      setTextColor(R.id.notif_title, android.graphics.Color.WHITE)
      setTextColor(R.id.notif_subtitle, 0xB3FFFFFF.toInt()) // 70% white
      if (isRecording) {
        setImageViewResource(R.id.btn_end_call, R.drawable.ic_recording_widget_stop)
      }
      setOnClickPendingIntent(R.id.btn_end_call, stopPendingIntent)
    }

    return NotificationCompat.Builder(this, if (isRecording) RECORDING_CHANNEL_ID else CHANNEL_ID)
      .setSmallIcon(if (isRecording) android.R.drawable.ic_btn_speak_now else android.R.drawable.ic_menu_call)
      .setContentTitle(title)
      .setContentText(elapsed)
      .setCustomContentView(remoteViews)
      .setCustomBigContentView(remoteViews)
      .setContentIntent(contentIntent)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun updateNotification() {
    val notification = buildNotification()
    notificationManager?.notify(NOTIFICATION_ID, notification)
  }
}
`;
}

function buildVoIPForegroundServiceModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.lang.ref.WeakReference

class VoIPForegroundServiceModule(reactContext: ReactApplicationContext) :
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

  override fun getName(): String = "VoIPForegroundServiceModule"

  // Tells JS (which ships over the air) that the call service no longer needs RECORD_AUDIO
  // to start; older binaries crash on Android 14+ if a call is joined without mic access.
  override fun getConstants(): Map<String, Any> = mapOf("supportsCallWithoutMicrophone" to true)

  @ReactMethod
  fun startService(startedAt: Double, promise: Promise) {
    launchService(startedAt, VoIPForegroundService.MODE_CALL, promise)
  }

  // A separate method rather than a mode argument on startService: JS ships over
  // the air, and changing startService's arity would break calls on binaries
  // built before recording mode existed.
  @ReactMethod
  fun startRecordingService(startedAt: Double, promise: Promise) {
    launchService(startedAt, VoIPForegroundService.MODE_RECORDING, promise)
  }

  private fun launchService(startedAt: Double, mode: String, promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, VoIPForegroundService::class.java).apply {
        action = VoIPForegroundService.ACTION_START
        putExtra(VoIPForegroundService.EXTRA_STARTED_AT, startedAt.toLong())
        putExtra(VoIPForegroundService.EXTRA_MODE, mode)
      }
      ctx.startForegroundService(intent)
      // Resolved to JS so the type the call ran as lands in the remote call-action logs.
      val type = VoIPForegroundService.describeServiceType(
        VoIPForegroundService.foregroundServiceType(ctx, mode)
      )
      Log.i(VoIPForegroundService.LOG_TAG, "VoIPForegroundServiceModule start requested mode=$mode type=$type")
      promise.resolve(type)
    } catch (e: Exception) {
      Log.e(VoIPForegroundService.LOG_TAG, "VoIPForegroundServiceModule start failed mode=$mode", e)
      promise.reject("VOIP_SERVICE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, VoIPForegroundService::class.java).apply {
        action = VoIPForegroundService.ACTION_STOP
      }
      ctx.startService(intent)
      Log.i(VoIPForegroundService.LOG_TAG, "VoIPForegroundServiceModule stop requested")
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(VoIPForegroundService.LOG_TAG, "VoIPForegroundServiceModule stop failed", e)
      promise.reject("VOIP_SERVICE_ERROR", e.message, e)
    }
  }

  // Required stubs for RCTEventEmitter on iOS-style listeners
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
`;
}

function buildVoIPForegroundServicePackageSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class VoIPForegroundServicePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(VoIPForegroundServiceModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

function buildVoIPCallActionReceiverSource(androidPackage) {
  return `package ${androidPackage}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.modules.core.DeviceEventManagerModule

class VoIPCallActionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      VoIPForegroundService.ACTION_END_CALL -> {
        Log.i(VoIPForegroundService.LOG_TAG, "End Call tapped in ongoing-call notification")
        try {
          // Stop the foreground service
          val stopIntent = Intent(context, VoIPForegroundService::class.java).apply {
            action = VoIPForegroundService.ACTION_STOP
          }
          context.startService(stopIntent)

          // Emit event to JS so call machine disconnects
          VoIPForegroundServiceModule.reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("VOIP_END_CALL", null)
        } catch (e: Exception) {
          Log.e(TAG, "Error handling end call action", e)
          safeRecordException("VoIPCallActionReceiver: end call action failed", e)
        }
      }
    }
  }

  private fun safeRecordException(message: String, e: Throwable) {
    try {
      com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().apply {
        log(message)
        recordException(e)
      }
    } catch (firebaseEx: Exception) {
      Log.w(TAG, "Crashlytics not available: " + firebaseEx.message)
    }
  }

  companion object {
    private const val TAG = "VoIPCallActionReceiver"
  }
}
`;
}

// ─── Lock-screen incoming call UI ────────────────────────────────────────────

function buildIncomingCallActivitySource(androidPackage) {
  return `package ${androidPackage}

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Space
import android.widget.TextView
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
import java.io.File
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

class IncomingCallActivity : Activity() {
  private var callId: String = ""
  private var callerName: String = "Lotus Caller"
  private var callerId: String = ""
  private var callType: String = "AUDIO"
  private var actionUrl: String = "/"
  private var channelId: String = ""
  private var startedFromLockedScreen: Boolean = false
  private var callerAvatarBitmap: Bitmap? = null

  // Ring timeout: the CallStyle notification expires on its own (setTimeoutAfter);
  // this full-screen UI must go with it or it would sit on the lock screen forever.
  private val ringTimeoutHandler = Handler(Looper.getMainLooper())
  private val ringTimeoutRunnable = Runnable {
    Log.i(TAG, "Ring timeout reached for incoming call — closing UI")
    finishIncomingCallTask()
  }

  // Two staggered pulses behind the avatar, same rhythm as the in-app incoming-call screen
  // (CallerAvatar's PulseRing): 1.8s, scale to 1.55x, fading out; the second starts half a
  // cycle later so a ring is always mid-pulse.
  private val ringAnimators = mutableListOf<ValueAnimator>()

  // The pulsing "swipe me" hint above each answer/decline button.
  private val swipeHintAnimators = mutableListOf<ObjectAnimator>()

  private val closeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val incomingCallId = intent?.getStringExtra(EXTRA_CALL_ID)
      if (incomingCallId.isNullOrBlank() || incomingCallId == callId) {
        finishIncomingCallTask()
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applyLockScreenFlags()

    callId = intent.getStringExtra(EXTRA_CALL_ID) ?: ""
    callerName = intent.getStringExtra(EXTRA_CALLER_NAME) ?: "Lotus Caller"
    callerId = intent.getStringExtra(EXTRA_CALLER_ID) ?: ""
    callType = intent.getStringExtra(EXTRA_CALL_TYPE) ?: "AUDIO"
    actionUrl = intent.getStringExtra(EXTRA_ACTION_URL) ?: "/"
    channelId = intent.getStringExtra(EXTRA_CHANNEL_ID) ?: ""
    startedFromLockedScreen = intent.getBooleanExtra(EXTRA_STARTED_FROM_LOCKED_SCREEN, false)
    callerAvatarBitmap = decodeCallerAvatar(intent.getStringExtra(EXTRA_CALLER_PICTURE_PATH))

    registerCloseReceiver()
    setContentView(buildContentView())

    val ringDeadline = intent.getLongExtra(EXTRA_RING_DEADLINE, System.currentTimeMillis() + RING_TIMEOUT_MS)
    val remainingMs = (ringDeadline - System.currentTimeMillis()).coerceIn(0L, RING_TIMEOUT_MS)
    ringTimeoutHandler.postDelayed(ringTimeoutRunnable, remainingMs)
  }

  override fun onDestroy() {
    ringTimeoutHandler.removeCallbacks(ringTimeoutRunnable)
    ringAnimators.forEach { it.cancel() }
    ringAnimators.clear()
    swipeHintAnimators.forEach { it.cancel() }
    swipeHintAnimators.clear()
    try {
      unregisterReceiver(closeReceiver)
    } catch (_: Exception) {
      // Receiver may not be registered if Activity creation failed early.
    }
    super.onDestroy()
  }

  /**
   * Best-effort: absent (no caller id in this push, or we've simply never seen this person's
   * avatar before) or corrupt just falls back to the initials avatar, exactly as before.
   */
  private fun decodeCallerAvatar(path: String?): Bitmap? {
    if (path.isNullOrBlank()) return null
    return decodeCallerAvatarFile(path)
  }

  @Suppress("DEPRECATION")
  override fun onBackPressed() {
    finishIncomingCallTask()
  }

  private fun finishIncomingCallTask() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(false)
      setTurnScreenOn(false)
    } else {
      @Suppress("DEPRECATION")
      window.clearFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.clearFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
    )
    finishAndRemoveTask()
  }

  private fun applyLockScreenFlags() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }

    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
    )
    @Suppress("DEPRECATION")
    window.decorView.systemUiVisibility =
      View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
  }

  private fun registerCloseReceiver() {
    val filter = IntentFilter(ACTION_CLOSE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(closeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(closeReceiver, filter)
    }
  }

  private fun buildContentView(): View {
    val container = FrameLayout(this)
    container.addView(buildBackdrop(), FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ))

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      clipChildren = false
      setPadding(dp(28), dp(40), dp(28), dp(40))
    }
    container.addView(root, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ))

    // Same top label as the in-app incoming-call screen's appLabel.
    val appLabel = TextView(this).apply {
      text = "XYNE SPACES"
      setTextColor(0x73FFFFFF.toInt())
      textSize = 13f
      letterSpacing = 0.08f
      gravity = Gravity.CENTER
      setPadding(0, dp(16), 0, 0)
    }
    root.addView(appLabel, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    ))

    // Flexible gaps above and below the caller block, matching the in-app screen's
    // justifyContent:'space-between' over [label, caller info, actions].
    root.addView(Space(this), LinearLayout.LayoutParams(1, 0).apply {
      weight = 1f
    })

    root.addView(buildAvatar(), LinearLayout.LayoutParams(dp(AVATAR_RING_SIZE_DP), dp(AVATAR_RING_SIZE_DP)))

    val title = TextView(this).apply {
      text = callerName
      setTextColor(Color.WHITE)
      textSize = 24f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      maxLines = 2
      ellipsize = TextUtils.TruncateAt.END
      includeFontPadding = false
    }
    root.addView(title, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply {
      topMargin = dp(16)
    })

    val subtitle = TextView(this).apply {
      text = callKindText()
      setTextColor(0x80FFFFFF.toInt())
      textSize = 14f
      gravity = Gravity.CENTER
      setPadding(0, dp(2), 0, 0)
    }
    root.addView(subtitle, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    ))

    root.addView(Space(this), LinearLayout.LayoutParams(1, 0).apply {
      weight = 1f
    })

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
      // The swipe gesture moves a button up past its own laid-out box; without this, the
      // default clipChildren=true clips it right back to that box as it moves, so it looks
      // like it's disappearing into whatever's above it.
      clipChildren = false
    }

    actions.addView(actionControl(
      label = "Decline",
      iconResId = R.drawable.ic_call_end,
      color = Color.rgb(239, 68, 68),
      contentDescription = "Decline call"
    ) {
      sendCallAction(IncomingCallNotificationReceiver.ACTION_DECLINE_CALL)
    }, LinearLayout.LayoutParams(dp(112), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      marginEnd = dp(34)
    })

    actions.addView(actionControl(
      label = "Answer",
      iconResId = R.drawable.ic_phone_answer,
      color = Color.rgb(34, 197, 94),
      contentDescription = "Answer call"
    ) {
      sendCallAction(IncomingCallNotificationReceiver.ACTION_ANSWER_CALL)
    }, LinearLayout.LayoutParams(dp(112), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      marginStart = dp(34)
    })

    root.addView(actions, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply {
      bottomMargin = dp(12)
    })

    return container
  }

  /**
   * Same look as the in-app incoming-call screen's CallBackdrop: a dark base, the caller's
   * blurred photo behind everything when we have one, and a tint of their identity colour
   * fading into the base toward the bottom.
   */
  private fun buildBackdrop(): View {
    val container = FrameLayout(this)

    container.addView(
      View(this).apply { setBackgroundColor(Color.parseColor(STAGE_COLOR)) },
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
    )

    callerAvatarBitmap?.let { bitmap ->
      val photo = ImageView(this).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        alpha = 0.55f
        scaleX = 1.25f
        scaleY = 1.25f
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          // Real GPU Gaussian blur — same look expo-image's blurRadius gives the in-app screen.
          setImageBitmap(bitmap)
          setRenderEffect(
            RenderEffect.createBlurEffect(dp(BLUR_RADIUS_DP).toFloat(), dp(BLUR_RADIUS_DP).toFloat(), Shader.TileMode.CLAMP)
          )
        } else {
          setImageBitmap(blurredBackground(bitmap))
        }
      }
      container.addView(
        photo,
        FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
      )
    }

    val tint = identityTintColor(callerId.ifBlank { callerName })
    container.addView(
      GradientOverlayView(this, tint),
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
    )

    return container
  }

  /**
   * Pre-Android-12 fallback (no RenderEffect): halving the bitmap a few times acts like a cheap
   * box blur — each pass genuinely averages its neighbours, unlike one big downscale jump, which
   * would just alias. Then one upscale back to size.
   */
  private fun blurredBackground(source: Bitmap): Bitmap {
    var current = source
    repeat(5) {
      val w = (current.width / 2).coerceAtLeast(1)
      val h = (current.height / 2).coerceAtLeast(1)
      current = Bitmap.createScaledBitmap(current, w, h, true)
    }
    return Bitmap.createScaledBitmap(current, source.width, source.height, true)
  }

  /**
   * Same deterministic hash as the in-app CallBackdrop's getAvatarColors (callStage.utils.ts), so
   * the lock-screen tint lines up with the caller's tile colour once the call connects. Not
   * guaranteed bit-identical to the JS hash for very long identities (a 32-bit truncation detail
   * in how each side folds the running hash) — that only ever changes which of 8 backdrop tints
   * is picked, never anything user-visible as a bug.
   */
  private fun identityTintColor(identity: String): Int {
    val safe = identity.ifBlank { "unknown" }
    var hash = 0
    for (ch in safe) {
      hash = ch.code + ((hash shl 5) - hash)
    }
    val index = abs(hash) % AVATAR_BACKGROUND_COLORS.size
    return Color.parseColor(AVATAR_BACKGROUND_COLORS[index])
  }

  /** Paints the [0, 0.45, 1] tint → tint → stage gradient from CallBackdrop's LinearGradient. */
  private class GradientOverlayView(context: Context, private val tint: Int) : View(context) {
    private val paint = Paint()

    override fun onDraw(canvas: Canvas) {
      val colors = intArrayOf(
        withAlpha(tint, 230),
        withAlpha(tint, 102),
        withAlpha(Color.parseColor(STAGE_COLOR), 242)
      )
      paint.shader = LinearGradient(
        0f, 0f, 0f, height.toFloat(), colors, floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
      )
      canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    }

    private fun withAlpha(color: Int, alpha: Int): Int =
      Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
  }

  /**
   * The caller's photo when we have one cached, otherwise the same initials-on-colour circle as
   * before — either way wrapped in two pulsing rings, matching the in-app incoming-call screen.
   */
  private fun buildAvatar(): View {
    val container = FrameLayout(this).apply {
      clipChildren = false
      clipToPadding = false
    }

    val ringSize = dp(AVATAR_RING_SIZE_DP)
    val ringParams = FrameLayout.LayoutParams(ringSize, ringSize)
    container.addView(buildPulseRing(delayMs = 0), FrameLayout.LayoutParams(ringParams))
    container.addView(buildPulseRing(delayMs = PULSE_DURATION_MS / 2), FrameLayout.LayoutParams(ringParams))

    val avatarSize = dp(AVATAR_INNER_SIZE_DP)
    val bitmap = callerAvatarBitmap
    val avatarView: View = if (bitmap != null) {
      ImageView(this).apply {
        val rounded = RoundedBitmapDrawableFactory.create(resources, bitmap).apply {
          isCircular = true
        }
        setImageDrawable(rounded)
        scaleType = ImageView.ScaleType.CENTER_CROP
      }
    } else {
      TextView(this).apply {
        text = callerInitials()
        setTextColor(Color.WHITE)
        textSize = 34f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        includeFontPadding = false
        background = oval(Color.rgb(37, 99, 235), 0x33FFFFFF, 1)
      }
    }
    container.addView(avatarView, FrameLayout.LayoutParams(avatarSize, avatarSize).apply {
      gravity = Gravity.CENTER
    })

    return container
  }

  /** A stroke-only ring that expands and fades on a loop; starts invisible during its delay. */
  private fun buildPulseRing(delayMs: Long): View {
    val ring = View(this).apply {
      background = oval(Color.TRANSPARENT, 0xFFFFFFFF.toInt(), 2)
      alpha = 0f
    }

    val animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = PULSE_DURATION_MS
      startDelay = delayMs
      repeatCount = ValueAnimator.INFINITE
      interpolator = LinearInterpolator()
      addUpdateListener { animation ->
        val t = animation.animatedValue as Float
        val scale = 1f + PULSE_MAX_SCALE_DELTA * t
        ring.scaleX = scale
        ring.scaleY = scale
        ring.alpha = PULSE_MAX_ALPHA * (1f - t)
      }
      start()
    }
    ringAnimators.add(animator)

    return ring
  }

  private fun actionControl(
    label: String,
    iconResId: Int,
    color: Int,
    contentDescription: String,
    onClick: () -> Unit
  ): LinearLayout =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      // See the matching comment on 'actions' — same reason, one level down.
      clipChildren = false

      // Pulsing hint above the button — same up-chevron cue as the in-app SwipeButton.
      val hint = TextView(this@IncomingCallActivity).apply {
        text = "▲"
        setTextColor(0xB3FFFFFF.toInt())
        textSize = 12f
        gravity = Gravity.CENTER
        alpha = 0.4f
      }
      addView(hint, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        bottomMargin = dp(4)
      })
      swipeHintAnimators.add(
        ObjectAnimator.ofFloat(hint, View.ALPHA, 0.4f, 0.9f).apply {
          duration = 700
          repeatMode = ValueAnimator.REVERSE
          repeatCount = ValueAnimator.INFINITE
          start()
        }
      )

      val button = ImageButton(this@IncomingCallActivity).apply {
        setImageResource(iconResId)
        setColorFilter(Color.WHITE)
        scaleType = ImageView.ScaleType.CENTER
        setPadding(dp(16), dp(16), dp(16), dp(16))
        background = oval(color)
        this.contentDescription = contentDescription
        minimumWidth = 0
        minimumHeight = 0
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          elevation = dp(3).toFloat()
          stateListAnimator = null
        }
        setOnClickListener { onClick() }
        attachSwipeOrTap(this)
      }
      addView(button, LinearLayout.LayoutParams(dp(64), dp(64)))

      val labelView = TextView(this@IncomingCallActivity).apply {
        text = label
        setTextColor(0xA6FFFFFF.toInt())
        textSize = 13f
        gravity = Gravity.CENTER
        includeFontPadding = false
      }
      addView(labelView, LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(14)
      })
    }

  /**
   * Swipe the button up past [SWIPE_THRESHOLD_DP], or just tap it — either answers/declines,
   * matching the in-app incoming-call screen's SwipeButton (a quick, small wiggle still counts
   * as a tap; only a deliberate upward drag counts as a swipe). Releasing short of the threshold
   * springs the button back to rest.
   */
  @SuppressLint("ClickableViewAccessibility")
  private fun attachSwipeOrTap(view: View) {
    val threshold = dp(SWIPE_THRESHOLD_DP).toFloat()
    var startY = 0f

    view.setOnTouchListener { v, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          startY = event.rawY
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val delta = (event.rawY - startY).coerceAtMost(0f)
          v.translationY = delta
          val progress = (-delta / threshold).coerceIn(0f, 1f)
          v.scaleX = 1f + 0.15f * progress
          v.scaleY = 1f + 0.15f * progress
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          val delta = event.rawY - startY
          val wasSwipe = delta <= -threshold
          val wasTap = abs(delta) < dp(10)
          v.animate().translationY(0f).scaleX(1f).scaleY(1f).setDuration(180).start()
          // performClick() runs the click listener — the same path TalkBack's double-tap takes.
          if (event.actionMasked == MotionEvent.ACTION_UP && (wasSwipe || wasTap)) {
            v.performClick()
          }
          true
        }
        else -> false
      }
    }
  }

  private fun sendCallAction(action: String) {
    val receiverIntent = Intent(this, IncomingCallNotificationReceiver::class.java).apply {
      this.action = action
      putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_ID, callId)
      putExtra(IncomingCallNotificationReceiver.EXTRA_CALLER_NAME, callerName)
      putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_TYPE, callType)
      putExtra(IncomingCallNotificationReceiver.EXTRA_ACTION_URL, actionUrl)
      putExtra(IncomingCallNotificationReceiver.EXTRA_CHANNEL_ID, channelId)
      putExtra(
        IncomingCallNotificationReceiver.EXTRA_ANSWERED_FROM_LOCKED_SCREEN,
        startedFromLockedScreen
      )
    }
    sendBroadcast(receiverIntent)
    finishIncomingCallTask()
  }

  private fun callKindText(): String =
    if (callType.equals("VIDEO", ignoreCase = true)) "Incoming video call" else "Incoming audio call"

  private fun callerInitials(): String {
    val parts = callerName.trim().split(" ").filter { it.isNotBlank() }
    val raw = when {
      parts.size >= 2 -> parts.first().take(1) + parts.last().take(1)
      parts.size == 1 -> parts.first().take(2)
      else -> "L"
    }
    return raw.uppercase(Locale.getDefault())
  }

  private fun oval(color: Int, strokeColor: Int? = null, strokeWidthDp: Int = 0): GradientDrawable =
    GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(color)
      if (strokeColor != null && strokeWidthDp > 0) {
        setStroke(dp(strokeWidthDp), strokeColor)
      }
    }

  private fun dp(value: Int): Int =
    (value * resources.displayMetrics.density).roundToInt()

  companion object {
    const val ACTION_CLOSE = "${androidPackage}.ACTION_CLOSE_INCOMING_CALL_UI"
    const val EXTRA_CALL_ID = "call_id"
    const val EXTRA_CALLER_NAME = "caller_name"
    /** The backend's optional callerId from this push's metadata; see CallNotificationDataModule.
     * Used only to pick the backdrop's tint colour and look up a cached avatar — never required. */
    const val EXTRA_CALLER_ID = "caller_id"
    /** Local file path of the caller's cached avatar; see CallNotificationDataModule. Optional —
     * absent whenever the push carried no caller id, or we've never cached that user's avatar. */
    const val EXTRA_CALLER_PICTURE_PATH = "caller_picture_path"
    const val EXTRA_CALL_TYPE = "call_type"
    const val EXTRA_ACTION_URL = "action_url"
    const val EXTRA_CHANNEL_ID = "channel_id"
    const val EXTRA_STARTED_FROM_LOCKED_SCREEN = "started_from_locked_screen"
    const val EXTRA_RING_DEADLINE = "ring_deadline"

    /** Keep in sync with CALL_RING_TIMEOUT_MS in src/services/PushNotificationPayload.ts. */
    const val RING_TIMEOUT_MS = 30_000L

    /**
     * An INCOMING_CALL held by FCM longer than this (device offline) never rings:
     * the call is over and the backend's MISSED_CALL covers the UX.
     * Keep in sync with STALE_CALL_PUSH_THRESHOLD_MS.
     */
    const val STALE_CALL_PUSH_THRESHOLD_MS = 30_000L
    private const val TAG = "IncomingCallActivity"

    // Avatar + pulse-ring look, matching the in-app incoming-call screen's CallerAvatar
    // (both now share ParticipantAvatar/RingPulse.tsx's PULSE_DURATION_MS/PULSE_MAX_SCALE).
    private const val AVATAR_RING_SIZE_DP = 110
    private const val AVATAR_INNER_SIZE_DP = 100
    private const val PULSE_DURATION_MS = 2000L
    private const val PULSE_MAX_SCALE_DELTA = 0.9f
    private const val PULSE_MAX_ALPHA = 0.42f

    // Backdrop look, matching the in-app incoming-call screen's CallBackdrop.
    private const val STAGE_COLOR = "#131314"
    private const val BLUR_RADIUS_DP = 25
    /** Dark backdrop half of each [avatar, background] pair in callStage.utils.ts. */
    private val AVATAR_BACKGROUND_COLORS = listOf(
      "#0D3D2E", "#3D2F0B", "#1E3A5F", "#2D1F4D", "#4D1F35", "#0D3D44", "#3D2510", "#0D3D36"
    )

    /** Swipe-to-answer/decline, matching the in-app incoming-call screen's SwipeButton. */
    private const val SWIPE_THRESHOLD_DP = 50
  }
}
`;
}

function buildIncomingCallUiModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class IncomingCallUiModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "IncomingCallUiModule"

  @ReactMethod
  fun getIncomingCallUiState(promise: Promise) {
    try {
      val context = reactApplicationContext
      val result = Arguments.createMap()
      result.putBoolean("notificationsGranted", NotificationManagerCompat.from(context).areNotificationsEnabled())

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        result.putBoolean("fullScreenIntentGranted", manager.canUseFullScreenIntent())
      } else {
        result.putNull("fullScreenIntentGranted")
      }

      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("INCOMING_CALL_UI_STATE_ERROR", e.message, e)
    }
  }

  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    try {
      val context = reactApplicationContext
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:" + context.packageName)
        }
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:" + context.packageName)
        }
      }

      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("INCOMING_CALL_UI_SETTINGS_ERROR", e.message, e)
    }
  }
}
`;
}

function buildIncomingCallUiPackageSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class IncomingCallUiPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(IncomingCallUiModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

// ─── Notification layout + drawables ─────────────────────────────────────────

// Layout for incoming call notification (caller name + decline/answer icon buttons)
function buildNotificationIncomingCallLayoutXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="wrap_content"
  android:orientation="horizontal"
  android:gravity="center_vertical"
  android:paddingStart="12dp"
  android:paddingEnd="8dp"
  android:paddingTop="10dp"
  android:paddingBottom="10dp"
  android:minHeight="56dp">

  <!-- Caller info -->
  <LinearLayout
    android:layout_width="0dp"
    android:layout_height="wrap_content"
    android:layout_weight="1"
    android:orientation="vertical"
    android:layout_gravity="center_vertical">

    <TextView
      android:id="@+id/notif_caller_name"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="Caller"
      android:textSize="14sp"
      android:textStyle="bold"
      android:maxLines="1"
      android:ellipsize="end" />

    <TextView
      android:id="@+id/notif_call_type"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="Incoming call"
      android:textSize="12sp"
      android:maxLines="1" />

  </LinearLayout>

  <!-- Decline button: red circle, left of answer -->
  <ImageButton
    android:id="@+id/btn_decline"
    android:layout_width="42dp"
    android:layout_height="42dp"
    android:layout_gravity="center_vertical"
    android:layout_marginEnd="10dp"
    android:background="@drawable/bg_end_call_button"
    android:src="@drawable/ic_call_end"
    android:scaleType="centerInside"
    android:contentDescription="Decline"
    android:padding="10dp" />

  <!-- Answer button: green circle, right -->
  <ImageButton
    android:id="@+id/btn_answer"
    android:layout_width="42dp"
    android:layout_height="42dp"
    android:layout_gravity="center_vertical"
    android:background="@drawable/bg_answer_button"
    android:src="@drawable/ic_phone_answer"
    android:scaleType="centerInside"
    android:contentDescription="Answer"
    android:padding="10dp" />

</LinearLayout>
`;
}

// Green circle for answer button
function buildBgAnswerButtonDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="oval">
  <solid android:color="#22C55E" />
</shape>
`;
}

// White phone icon (standard pick-up gesture — handset pointing up-right)
function buildIcPhoneAnswerDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <path
    android:fillColor="#FFFFFF"
    android:pathData="M20,15.5c-1.25,0-2.45-0.2-3.57-0.57c-0.35-0.11-0.74-0.03-1.02,0.24l-2.2,2.2c-2.83-1.44-5.15-3.75-6.59-6.59l2.2-2.21c0.28-0.26,0.36-0.65,0.25-1C8.7,6.45,8.5,5.25,8.5,4c0-0.55-0.45-1-1-1H4c-0.55,0-1,0.45-1,1c0,9.39,7.61,17,17,17c0.55,0,1-0.45,1-1v-3.5C21,15.95,20.55,15.5,20,15.5z" />
</vector>
`;
}

function buildNotificationLayoutXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="wrap_content"
  android:orientation="horizontal"
  android:gravity="center_vertical"
  android:paddingStart="12dp"
  android:paddingEnd="8dp"
  android:paddingTop="10dp"
  android:paddingBottom="10dp"
  android:minHeight="56dp">

  <!-- Text block -->
  <LinearLayout
    android:layout_width="0dp"
    android:layout_height="wrap_content"
    android:layout_weight="1"
    android:orientation="vertical"
    android:layout_gravity="center_vertical">

    <TextView
      android:id="@+id/notif_title"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="Call in progress"
      android:textSize="14sp"
      android:textStyle="bold"
      android:maxLines="1"
      android:ellipsize="end" />

    <TextView
      android:id="@+id/notif_subtitle"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="00:00"
      android:textSize="12sp"
      android:maxLines="1" />

  </LinearLayout>

  <!-- End-call icon button: red circle with white phone icon -->
  <ImageButton
    android:id="@+id/btn_end_call"
    android:layout_width="40dp"
    android:layout_height="40dp"
    android:layout_gravity="center_vertical"
    android:layout_marginStart="8dp"
    android:background="@drawable/bg_end_call_button"
    android:src="@drawable/ic_call_end"
    android:scaleType="centerInside"
    android:contentDescription="End call"
    android:padding="10dp" />

</LinearLayout>
`;
}

function buildBgEndCallButtonDrawable() {
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
  android:shape="oval">
  <solid android:color="@color/colorEndCall" />
</shape>
`;
}

// Clean call-end icon: standard Material phone icon rotated 135° (hanging up)
function buildIcCallEndDrawableSimple() {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp"
  android:height="24dp"
  android:viewportWidth="24"
  android:viewportHeight="24">
  <!--
    Standard Material phone icon rotated 135 degrees around center (12,12).
    Rotation makes it point downward-right = visual "hang up / end call" gesture.
    This is the exact same technique Android's built-in call_end icon uses.
  -->
  <group
    android:pivotX="12"
    android:pivotY="12"
    android:rotation="135">
    <path
      android:fillColor="#FFFFFF"
      android:pathData="M20,15.5c-1.25,0-2.45-0.2-3.57-0.57c-0.35-0.11-0.74-0.03-1.02,0.24l-2.2,2.2c-2.83-1.44-5.15-3.75-6.59-6.59l2.2-2.21c0.28-0.26,0.36-0.65,0.25-1C8.7,6.45,8.5,5.25,8.5,4c0-0.55-0.45-1-1-1H4c-0.55,0-1,0.45-1,1c0,9.39,7.61,17,17,17c0.55,0,1-0.45,1-1v-3.5C21,15.95,20.55,15.5,20,15.5z" />
  </group>
</vector>
`;
}

// ─── Protected native auth handoff for background Kotlin ---------------------

function buildAuthContextModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.content.Context
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactMethod

internal data class StoredAuthContext(val token: String, val apiBaseUrl: String?)

internal object AuthContextStore {
  private const val PREFS_NAME = "XyneAuthContext"
  private const val KEY_ALIAS = "XyneAuthContext.AesKey.v1"
  private const val CIPHERTEXT_KEY = "auth_token_ciphertext"
  private const val IV_KEY = "auth_token_iv"
  private const val API_BASE_URL_KEY = "api_base_url"
  private const val LEGACY_TOKEN_KEY = "auth_token"
  private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_TAG_BITS = 128

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    if (existing != null) return existing

    val generator = KeyGenerator.getInstance("AES", KEYSTORE_PROVIDER)
    generator.init(
      android.security.keystore.KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
          android.security.keystore.KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  @Synchronized
  fun write(context: Context, token: String, apiBaseUrl: String) {
    require(token.isNotBlank()) { "auth token must not be blank" }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val ciphertext = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val stored = prefs.edit()
      .putString(CIPHERTEXT_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString(API_BASE_URL_KEY, apiBaseUrl)
      .commit()
    check(stored) { "Unable to persist protected auth context" }

    val verified = readProtected(context)
    check(verified?.token == token && verified.apiBaseUrl == apiBaseUrl) {
      "Unable to verify protected auth context"
    }
    check(prefs.edit().remove(LEGACY_TOKEN_KEY).commit()) {
      "Unable to remove legacy auth context"
    }
  }

  private fun readProtected(context: Context): StoredAuthContext? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val ciphertextValue = prefs.getString(CIPHERTEXT_KEY, null)
    val ivValue = prefs.getString(IV_KEY, null)
    val apiBaseUrl = prefs.getString(API_BASE_URL_KEY, null)

    if (ciphertextValue.isNullOrBlank() || ivValue.isNullOrBlank()) return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivValue, Base64.NO_WRAP))
      )
      val token = String(
        cipher.doFinal(Base64.decode(ciphertextValue, Base64.NO_WRAP)),
        StandardCharsets.UTF_8
      )
      if (token.isBlank()) null else StoredAuthContext(token, apiBaseUrl)
    } catch (error: Exception) {
      Log.w("AuthContextStore", "Protected auth handoff unavailable", error)
      null
    }
  }

  @Synchronized
  fun read(context: Context): StoredAuthContext? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val apiBaseUrl = prefs.getString(API_BASE_URL_KEY, null)
    val ciphertextValue = prefs.getString(CIPHERTEXT_KEY, null)
    val ivValue = prefs.getString(IV_KEY, null)
    // Key presence is authoritative even if a value was interrupted as an
    // empty string; otherwise legacy migration could revive a stale bearer.
    val hasCiphertext = prefs.contains(CIPHERTEXT_KEY)
    val hasIv = prefs.contains(IV_KEY)
    val hasProtectedMaterial = hasCiphertext || hasIv
    val hasCompleteProtectedValue =
      !ciphertextValue.isNullOrBlank() && !ivValue.isNullOrBlank()

    if (hasProtectedMaterial) {
      // A partially persisted protected value is corruption, not a signal to
      // revive the old plaintext preference. Fail closed until a new login
      // writes a complete ciphertext/IV pair.
      if (!hasCompleteProtectedValue) {
        Log.w("AuthContextStore", "Incomplete protected auth handoff; refusing legacy fallback")
        return null
      }
      val protected = readProtected(context)
      if (protected != null) {
        // A process death can occur after protected read-back but before the
        // separate legacy cleanup commit. Retry cleanup only after successful
        // decryption; never fall back to plaintext when protected storage is
        // unavailable.
        if (!prefs.edit().remove(LEGACY_TOKEN_KEY).commit()) {
          Log.w("AuthContextStore", "Unable to remove legacy auth context")
        }
      }
      return protected
    }

    // One-time upgrade from the old plaintext preference. Verify the encrypted
    // write before removing the legacy value; never return plaintext when the
    // Keystore is unavailable.
    val legacyToken = prefs.getString(LEGACY_TOKEN_KEY, null)
    if (legacyToken.isNullOrBlank()) return null
    return try {
      // write() performs protected read-back verification and retires the
      // legacy value only after that verification succeeds.
      write(context, legacyToken, apiBaseUrl.orEmpty())
      StoredAuthContext(legacyToken, apiBaseUrl)
    } catch (error: Exception) {
      Log.w("AuthContextStore", "Legacy auth handoff migration failed", error)
      null
    }
  }

  @Synchronized
  fun clear(context: Context) {
    check(
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    ) { "Unable to clear auth context" }
  }
}

class AuthContextModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AuthContextModule"

  @ReactMethod
  fun getAuthContextStorageVersion(promise: Promise) {
    promise.resolve(2)
  }

  @ReactMethod
  fun setAuthContext(authToken: String, apiBaseUrl: String, promise: Promise) {
    try {
      AuthContextStore.write(reactApplicationContext, authToken, apiBaseUrl)
      Log.d(TAG, "Auth context stored")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to store auth context", e)
      promise.reject("AUTH_CONTEXT_WRITE_FAILED", "Unable to store protected auth context", e)
    }
  }

  @ReactMethod
  fun clearAuthContext(promise: Promise) {
    try {
      AuthContextStore.clear(reactApplicationContext)
      Log.d(TAG, "Auth context cleared")
      promise.resolve(true)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to clear auth context", e)
      promise.reject("AUTH_CONTEXT_CLEAR_FAILED", "Unable to clear protected auth context", e)
    }
  }

  companion object {
    private const val TAG = "AuthContextModule"
  }
}
`;
}

function buildAuthContextPackageSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AuthContextPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AuthContextModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}

// ─── Plugin constants ─────────────────────────────────────────────────────────

const PLUGIN_NAME = 'with-native-incoming-call-android';
const PLUGIN_VERSION = '1.0.0';

const LEGACY_LAUNCH_INTENT_LOG_REPLACEMENTS = [
  [
    'android.util.Log.d("LaunchIntent", "onCreate called, intent=" + intent + ", extras=" + intent?.extras)',
    'android.util.Log.d("LaunchIntent", "onCreate received; hasIntent=" + (intent != null) + ", hasExtras=" + (intent?.extras != null))',
  ],
  [
    'android.util.Log.d("LaunchIntent", "Captured launch intent extras: callId=" + extras.getString("callId") + ", callAction=" + extras.getString("callAction"))',
    'android.util.Log.d("LaunchIntent", "Captured launch intent; hasCallId=" + !extras.getString("callId").isNullOrBlank() + ", action=" + extras.getString("callAction"))',
  ],
  [
    'android.util.Log.d("LaunchIntent", "onNewIntent called, extras=" + intent.extras)',
    'android.util.Log.d("LaunchIntent", "onNewIntent received; hasExtras=" + (intent.extras != null))',
  ],
  [
    'android.util.Log.d("LaunchIntent", "onNewIntent captured extras: callId=" + extras.getString("callId") + ", callAction=" + extras.getString("callAction"))',
    'android.util.Log.d("LaunchIntent", "onNewIntent captured; hasCallId=" + !extras.getString("callId").isNullOrBlank() + ", action=" + extras.getString("callAction"))',
  ],
];

function sanitizeLegacyLaunchIntentLogs(contents) {
  return LEGACY_LAUNCH_INTENT_LOG_REPLACEMENTS.reduce(
    (source, [legacyLog, safeLog]) => source.replace(legacyLog, safeLog),
    contents,
  );
}

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Security (bug bounty #44): MainActivity is exported (launcher + share target), so any
 * installed app can start it with forged "callId" / "callAction=answer" / "autoJoinCall"
 * extras and silently join the user into a call. Every call launch we build ourselves is
 * stamped with a per-install secret; MainActivity strips call extras that lack it.
 */
function buildCallLaunchGuardSource(androidPackage) {
  return `package ${androidPackage}

import android.content.Context
import android.content.Intent
import android.util.Log
import java.security.MessageDigest
import java.security.SecureRandom

object CallLaunchGuard {
  const val EXTRA_LAUNCH_PROOF = "xyneCallLaunchProof"
  private const val TAG = "CallLaunchGuard"
  private const val PREFS_NAME = "CallLaunchGuard"
  private const val KEY_SECRET = "secret"

  // Every extra MainActivity / JS treats as call-launch input.
  private val CALL_EXTRAS = listOf(
    "callId",
    "callAction",
    "callerName",
    "callType",
    "isIncomingCall",
    "actionUrl",
    "token",
    "serverUrl",
    "channelId",
    "fromBackgroundNotification",
    "autoJoinCall",
    "autoDeclineCall",
    "answeredFromLockedScreen",
  )

  // Only these make MainActivity / JS join, answer or decline a call. A plain
  // notification tap can carry "channelId" / "actionUrl" (FCM puts data keys on the
  // launch intent), so those alone must not trigger stripping or the tap would lose
  // its chat target.
  private val CALL_TRIGGER_EXTRAS = listOf(
    "callAction",
    "isIncomingCall",
    "autoJoinCall",
    "autoDeclineCall",
    "answeredFromLockedScreen",
  )

  @Volatile private var cachedSecret: String? = null

  @JvmStatic
  @Synchronized
  fun secret(context: Context): String {
    cachedSecret?.let { return it }
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_SECRET, null)
    if (!existing.isNullOrEmpty()) {
      cachedSecret = existing
      return existing
    }
    val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
    val generated = bytes.joinToString("") { "%02x".format(it) }
    prefs.edit().putString(KEY_SECRET, generated).commit()
    cachedSecret = generated
    return generated
  }

  /** Marks an Intent we built ourselves as a trusted call launch. */
  @JvmStatic
  fun stamp(context: Context, intent: Intent): Intent =
    intent.putExtra(EXTRA_LAUNCH_PROOF, secret(context))

  /**
   * Removes call-launch extras from [intent] unless it carries our launch token.
   * Returns true when the intent is trusted or is not a call launch.
   */
  @JvmStatic
  fun sanitize(context: Context, intent: Intent?): Boolean {
    if (intent == null) return true
    val extras = try {
      intent.extras
    } catch (e: Exception) {
      // Malformed parcel from another app — drop everything.
      Log.w(TAG, "Dropping unreadable launch extras", e)
      intent.replaceExtras(null as android.os.Bundle?)
      return false
    } ?: return true

    val isCallLaunch = CALL_TRIGGER_EXTRAS.any { extras.containsKey(it) }
    if (!isCallLaunch) return true

    val presented = extras.getString(EXTRA_LAUNCH_PROOF)
    val trusted = presented != null &&
      MessageDigest.isEqual(presented.toByteArray(), secret(context).toByteArray())
    if (!trusted) {
      Log.w(TAG, "Ignoring call extras from an untrusted launch intent")
      CALL_EXTRAS.forEach(intent::removeExtra)
      intent.removeExtra(EXTRA_LAUNCH_PROOF)
    }
    return trusted
  }
}
`;
}

function buildLaunchIntentModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.app.Activity
import android.os.Bundle
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Native module to expose the Activity's launch intent to JavaScript.
 * This is needed to handle notification action buttons when the app is launched from background.
 */
class LotusLaunchIntentModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LotusLaunchIntentModule"

  @ReactMethod
  fun getLaunchIntent(promise: Promise) {
    // Prefer the extras captured in MainActivity.onCreate / onNewIntent. Those
    // survive Expo unmarshalling the tap response, and they stay readable when
    // getCurrentActivity() is briefly null during a surface remount.
    val extras: Bundle? = try {
      MainActivity.launchIntentExtras
    } catch (_: Throwable) {
      null
    } ?: getCurrentActivity()?.intent?.extras

    if (extras == null) {
      promise.resolve(null)
      return
    }

    val result = WritableNativeMap()
    val extrasMap = WritableNativeMap()
    writeExtras(extras, extrasMap, 0)
    result.putMap("extras", extrasMap)
    promise.resolve(result)
  }

  @ReactMethod
  fun clearLaunchIntent(promise: Promise) {
    try {
      MainActivity.clearLaunchIntentExtras()
    } catch (_: Throwable) {
    }
    promise.resolve(null)
  }

  // Recurse only into known Expo/FCM wrappers (\`data\`, \`payload\`). Nested
  // notification keys are copied last so they overwrite wrapper leftovers.
  // Depth is capped to avoid cyclic bundles.
  private fun writeExtras(extras: Bundle, extrasMap: WritableNativeMap, depth: Int) {
    if (depth > 3) return
    val wrapperBundles = ArrayList<Bundle>()
    for (key in extras.keySet()) {
      @Suppress("DEPRECATION")
      val value = extras.get(key)
      when (value) {
        is Bundle -> {
          val nestedMap = WritableNativeMap()
          writeExtras(value, nestedMap, depth + 1)
          extrasMap.putMap(key, nestedMap)
          if (key == "data" || key == "payload") {
            wrapperBundles.add(value)
          }
        }
        is String -> extrasMap.putString(key, value)
        is Boolean -> extrasMap.putBoolean(key, value)
        is Int -> extrasMap.putInt(key, value)
        is Double -> extrasMap.putDouble(key, value)
        is Long -> extrasMap.putDouble(key, value.toDouble())
        else -> extrasMap.putString(key, value?.toString())
      }
    }
    for (nested in wrapperBundles) {
      writeExtras(nested, extrasMap, depth + 1)
    }
  }

  companion object {
    const val NAME = "LotusLaunchIntentModule"
  }
}
`;
}

function buildNotificationHelperSource(androidPackage) {
  return `package ${androidPackage}

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.util.Log

object IncomingCallNotificationHelper {
  const val CHANNEL_ID = "incoming_calls"
  private const val TAG = "IncomingCallNotify"

  fun createNotificationChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return

    // Delete stale channel so sound settings can be updated
    // Android does not allow updating sound on existing channels
    notificationManager.deleteNotificationChannel(CHANNEL_ID)
    Log.d(TAG, "Deleted stale notification channel if it existed")

    // Check if channel already exists
    if (notificationManager.getNotificationChannel(CHANNEL_ID) != null) {
      Log.d(TAG, "Notification channel already exists")
      return
    }

    // Get the device's default ringtone (same as phone calls)
    val ringtoneUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Incoming Calls",
      NotificationManager.IMPORTANCE_MAX
    ).apply {
      description = "High priority notifications for incoming calls"
      setSound(ringtoneUri,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build())
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 1000, 500, 1000)
      setBypassDnd(true)
    }

    notificationManager.createNotificationChannel(channel)
    Log.i(TAG, "Created incoming calls notification channel with default ringtone")
  }
}
`;
}

function buildBroadcastReceiverSource(androidPackage) {
  return `package ${androidPackage}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.KeyguardManager
import android.app.NotificationManager
import android.util.Log
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import net.juspay.xynespaces.http.MtlsNetworkClient
import org.json.JSONObject

/**
 * BroadcastReceiver to handle notification action clicks (Answer/Decline) for incoming calls.
 * This runs without opening the app UI.
 */
class IncomingCallNotificationReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    Log.e(TAG, "[DECLINE] onReceive fired: action=" + intent.action)

    when (intent.action) {
      ACTION_ANSWER_CALL -> handleAnswer(context, intent)
      ACTION_DECLINE_CALL -> handleDecline(context, intent)
      ACTION_DISMISS_CALL -> handleDismiss(context, intent)
      else -> {
        Log.e(TAG, "[DECLINE] Unknown action: " + intent.action)
      }
    }
  }

  private fun handleAnswer(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(EXTRA_CALL_ID)
    Log.e(TAG, "[ANSWER] handleAnswer: hasCallId=" + !callId.isNullOrBlank() + ", hasExtras=" + (intent.extras != null))

    if (callId.isNullOrBlank()) {
      Log.e(TAG, "[ANSWER] No callId in answer intent — aborting")
      return
    }

    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    notificationManager?.cancel(callId.hashCode())
    closeIncomingCallUi(context, callId)

    storeCallAction(context, intent, callId, "answer")
    emitCallActionToJs("answer")
    launchAppForCallAction(context, intent, callId, "answer")
  }

  private fun handleDecline(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(EXTRA_CALL_ID)
    Log.e(TAG, "[DECLINE] handleDecline: hasCallId=" + !callId.isNullOrBlank() + ", hasExtras=" + (intent.extras != null))

    if (callId.isNullOrBlank()) {
      Log.e(TAG, "[DECLINE] No callId in decline intent — aborting")
      return
    }

    Log.e(TAG, "[DECLINE] Processing decline action")

    // Dismiss the notification immediately
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    notificationManager?.cancel(callId.hashCode())
    closeIncomingCallUi(context, callId)

    // Keep a background handoff for an already-running React Native process.
    try {
      val prefs = context.getSharedPreferences("CallNotificationData", Context.MODE_PRIVATE)
      val stored = prefs.edit()
        .putString("callId", callId)
        .putString("callAction", "decline")
        .putString("callerName", intent.getStringExtra(EXTRA_CALLER_NAME) ?: "Unknown Caller")
        .putString("callType", intent.getStringExtra(EXTRA_CALL_TYPE) ?: "AUDIO")
        .putBoolean("isIncomingCall", true)
        .putString("actionUrl", intent.getStringExtra(EXTRA_ACTION_URL) ?: "")
        .remove(LEGACY_TOKEN_KEY)
        .remove(LEGACY_SERVER_URL_KEY)
        .putString("channelId", intent.getStringExtra(EXTRA_CHANNEL_ID) ?: "")
        .putLong("timestamp", System.currentTimeMillis())
        .commit()
      if (!stored) {
        Log.w(TAG, "[DECLINE] Unable to persist call action")
      }
      Log.e(TAG, "[DECLINE] Stored call action")
    } catch (e: Exception) {
      Log.e(TAG, "[DECLINE] Failed to store in SharedPreferences", e)
      safeRecordException("handleDecline: SharedPreferences write failed", e)
    }
    emitCallActionToJs("decline")

    // Read the protected handoff at action time. Never put the bearer token in
    // notification/PendingIntent extras, which can outlive logout and be
    // inspected by other system components.
    val authContext = AuthContextStore.read(context)
    val authToken = authContext?.token
    val apiBaseUrl = authContext?.apiBaseUrl
    Log.d(TAG, "[DECLINE] protected auth context=" + (if (authContext != null) "available" else "MISSING"))

    // Call the decline API if we have the necessary info
    if (!authToken.isNullOrBlank() && !apiBaseUrl.isNullOrBlank()) {
      Log.e(TAG, "[DECLINE] Calling decline API directly from Kotlin")
      val pendingResult = goAsync()
      GlobalScope.launch(Dispatchers.IO) {
        try {
          declineCall(context, apiBaseUrl, authToken, callId)
        } catch (e: Exception) {
          Log.e(TAG, "[DECLINE] API call failed", e)
          safeRecordException("handleDecline: decline API call failed", e)
        } finally {
          pendingResult.finish()
        }
      }
    } else {
      Log.w(TAG, "[DECLINE] No auth token/URL; keeping decline local without launching the app")
    }
  }

  private fun handleDismiss(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(EXTRA_CALL_ID)

    if (callId.isNullOrBlank()) {
      Log.w(TAG, "No callId in dismiss intent")
      return
    }

    Log.i(TAG, "Handling dismiss action")

    // Just dismiss the notification
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    notificationManager?.cancel(callId.hashCode())
    closeIncomingCallUi(context, callId)
  }

  private fun storeCallAction(context: Context, intent: Intent, callId: String, action: String) {
    try {
      val prefs = context.getSharedPreferences("CallNotificationData", Context.MODE_PRIVATE)
      val stored = prefs.edit()
        .putString("callId", callId)
        .putString("callAction", action)
        .putString("callerName", intent.getStringExtra(EXTRA_CALLER_NAME) ?: "Unknown Caller")
        .putString("callType", intent.getStringExtra(EXTRA_CALL_TYPE) ?: "AUDIO")
        .putBoolean("isIncomingCall", true)
        .putString("actionUrl", intent.getStringExtra(EXTRA_ACTION_URL) ?: "")
        .remove(LEGACY_TOKEN_KEY)
        .remove(LEGACY_SERVER_URL_KEY)
        .putString("channelId", intent.getStringExtra(EXTRA_CHANNEL_ID) ?: "")
        .putLong("timestamp", System.currentTimeMillis())
        .commit()
      if (!stored) {
        Log.w(TAG, "[ACTION] Unable to persist call action")
      }
      Log.e(TAG, "[ACTION] Stored call action=$action")
    } catch (e: Exception) {
      Log.e(TAG, "[ACTION] Failed to store in SharedPreferences", e)
      safeRecordException("storeCallAction: SharedPreferences write failed", e)
    }
  }

  private fun launchAppForCallAction(context: Context, intent: Intent, callId: String, action: String) {
    try {
      val answeredFromLockedScreen =
        action == "answer" &&
          (intent.getBooleanExtra(EXTRA_ANSWERED_FROM_LOCKED_SCREEN, false) || isDeviceLocked(context))
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        putExtra("callId", callId)
        putExtra("callAction", action)
        putExtra("callerName", intent.getStringExtra(EXTRA_CALLER_NAME) ?: "Unknown Caller")
        putExtra("callType", intent.getStringExtra(EXTRA_CALL_TYPE) ?: "AUDIO")
        putExtra("isIncomingCall", true)
        putExtra("actionUrl", intent.getStringExtra(EXTRA_ACTION_URL) ?: "")
        putExtra("channelId", intent.getStringExtra(EXTRA_CHANNEL_ID) ?: "")
        putExtra("fromBackgroundNotification", true)
        putExtra("autoJoinCall", action == "answer")
        putExtra("autoDeclineCall", action == "decline")
        putExtra("answeredFromLockedScreen", answeredFromLockedScreen)
        CallLaunchGuard.stamp(context, this)
      }
      if (launchIntent != null) {
        context.startActivity(launchIntent)
        Log.e(TAG, "[ACTION] Launched app for action=$action")
      } else {
        Log.e(TAG, "[ACTION] getLaunchIntentForPackage returned null")
      }
    } catch (e: Exception) {
      Log.e(TAG, "[ACTION] Failed to launch app", e)
      safeRecordException("launchAppForCallAction: app launch failed", e)
    }
  }

  private fun isDeviceLocked(context: Context): Boolean =
    (context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked == true

  private fun closeIncomingCallUi(context: Context, callId: String) {
    try {
      val closeIntent = Intent(IncomingCallActivity.ACTION_CLOSE).apply {
        setPackage(context.packageName)
        putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
      }
      context.sendBroadcast(closeIntent)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to close incoming call activity: " + e.message)
    }
  }

  private fun emitCallActionToJs(action: String) {
    try {
      VoIPForegroundServiceModule.reactContext
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("CALL_ACTION_FROM_RECEIVER", action)
    } catch (e: Exception) {
      Log.w(TAG, "Failed to emit call action to JS: " + e.message)
    }
  }

  private suspend fun declineCall(context: Context, apiBaseUrl: String, authToken: String, callId: String) {
    val client = MtlsNetworkClient(context)
    val response = client.makeMtlsRequest(
      urlString = "$apiBaseUrl/calls/$callId/decline",
      method = "POST",
      headers = mapOf(
        "Authorization" to "Bearer $authToken",
        "Content-Type" to "application/json"
      ),
      body = "{}"
    )
    if (response.statusCode in 200..299) {
      Log.e(TAG, "[DECLINE] API success: responseCode=" + response.statusCode)
    } else {
      Log.e(TAG, "[DECLINE] API failed: responseCode=" + response.statusCode)
    }
  }

  private fun safeRecordException(message: String, e: Throwable) {
    try {
      com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().apply {
        log(message)
        recordException(e)
      }
    } catch (firebaseEx: Exception) {
      Log.w(TAG, "Crashlytics not available: " + firebaseEx.message)
    }
  }

  companion object {
    private const val TAG = "IncomingCallReceiver"
    const val ACTION_ANSWER_CALL = "${androidPackage}.ACTION_ANSWER_CALL"
    const val ACTION_DECLINE_CALL = "${androidPackage}.ACTION_DECLINE_CALL"
    const val ACTION_DISMISS_CALL = "${androidPackage}.ACTION_DISMISS_CALL"
    const val EXTRA_CALL_ID = "call_id"
    const val EXTRA_CALLER_NAME = "caller_name"
    const val EXTRA_CALL_TYPE = "call_type"
    const val EXTRA_ACTION_URL = "action_url"
    const val EXTRA_CHANNEL_ID = "channel_id"
    const val EXTRA_ANSWERED_FROM_LOCKED_SCREEN = "answered_from_locked_screen"
    const val LEGACY_TOKEN_KEY = "token"
    const val LEGACY_SERVER_URL_KEY = "serverUrl"
  }
}
`;
}

function buildServiceSource(androidPackage) {
  return `package ${androidPackage}

import android.app.ActivityManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.wazo.callkeep.Constants
import io.wazo.callkeep.VoiceConnectionService
import java.io.File
import net.juspay.xynespaces.http.MtlsNetworkClient
import org.json.JSONObject

/**
 * Decodes a cached caller avatar downsampled to roughly [targetPx] — the cache holds original
 * uploads, and a full-size photo can exhaust memory or make the notification too large to post.
 * Throwable, not Exception: an OutOfMemoryError here must cost the avatar, never the ring.
 */
internal fun decodeCallerAvatarFile(path: String, targetPx: Int = 256): Bitmap? {
  return try {
    if (!File(path).exists()) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= targetPx && bounds.outHeight / (sample * 2) >= targetPx) {
      sample *= 2
    }
    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
  } catch (t: Throwable) {
    Log.w("CallerAvatar", "Failed to decode caller avatar: " + t.message)
    null
  }
}

class LotusIncomingCallMessagingService : FirebaseMessagingService() {

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    Log.d(TAG, "onMessageReceived: messageId=" + remoteMessage.messageId)
    Log.d(TAG, "Notification present: " + (remoteMessage.notification != null))

    val data = remoteMessage.data
    if (data.isEmpty()) {
      Log.d(TAG, "Empty data payload, ignoring")
      return
    }

    val type = data["type"]
    if (type == null) {
      Log.d(TAG, "No type in payload, forwarding to expo-notifications")
      forwardToExpoNotifications(remoteMessage)
      return
    }

    Log.d(TAG, "Message type: " + type)

    // Case 0: CALL_DISMISS or MISSED_CALL - dismiss the incoming call notification
    if (type == "CALL_DISMISS" || type == "MISSED_CALL") {
      Log.d(TAG, "Call dismiss/missed notification received, dismissing notification")
      dismissCallNotification(data)
      // Also forward to expo-notifications for JS handling
      forwardToExpoNotifications(remoteMessage)
      return
    }

    // Case 1: non-call messages — chat types are displayed by v3 Notifee via RN Firebase
    // background handler; skip expo-notifications to avoid duplicate tray entries.
    if (type != "INCOMING_CALL") {
      if (CHAT_MESSAGE_TYPES.contains(type)) {
        Log.d(TAG, "Chat message — skip expo forward; RN Firebase + Notifee v3 will display")
        return
      }
      Log.d(TAG, "Non-call message, forwarding to expo-notifications")
      forwardToExpoNotifications(remoteMessage)
      return
    }

    // Case 2: INCOMING_CALL
    // sentTime is FCM's server-side send time. A ring push that sat in FCM while the
    // device was offline must not ring now — the call is long over.
    val sentTime = remoteMessage.sentTime
    val pushAgeMs = if (sentTime > 0L) System.currentTimeMillis() - sentTime else -1L
    if (pushAgeMs > IncomingCallActivity.STALE_CALL_PUSH_THRESHOLD_MS) {
      Log.w(TAG, "Stale INCOMING_CALL (age=" + pushAgeMs + "ms) — not ringing")
      return
    }

    // Ensure notification channel exists (idempotent)
    IncomingCallNotificationHelper.createNotificationChannel(this)

    if (isAppInForeground()) {
      // Foreground calls still need a sticky CallStyle notification. The Expo
      // foreground path shows a transient heads-up that collapses after a few seconds.
      Log.d(TAG, "App in foreground, showing direct persistent call notification")
      showDirectCallNotification(data)
    } else {
      // Background/Killed - always show full-screen notification directly
      // Bypass TelecomManager/CallKeep when app is killed - they crash because
      // CallKeep's internal state isn't initialized
      Log.d(TAG, "App in background/killed, showing full-screen notification")
      showDirectCallNotification(data)
    }
  }

  private fun showDirectCallNotification(data: Map<String, String>) {
    Log.d(TAG, "showDirectCallNotification START")

    try {
      // Parse metadata
      val metadata = parseMetadata(data["metadata"])
      val callId = metadata.optString("callId").ifBlank {
        data["callId"] ?: data["relatedEntityId"] ?: ""
      }

      if (callId.isBlank()) {
        Log.w(TAG, "No callId found, cannot show direct call notification")
        return
      }

      val callerName = metadata.optString("callerName").ifBlank {
        data["msg_title"] ?: "Lotus Caller"
      }
      val hasVideo = metadata.optString("callType").equals("VIDEO", ignoreCase = true)
      val callType = if (hasVideo) "VIDEO" else "AUDIO"
      val callTypeText = if (hasVideo) "Incoming video call" else "Incoming audio call"
      val actionUrl = data["actionUrl"] ?: "/"
      val channelId = metadata.optString("channelId").ifBlank { data["channelId"] ?: "" }
      val isLockedAtNotification = isDeviceLocked()
      val appForegroundAtNotification = isAppInForeground()

      // Best-effort — present only if the backend included the caller's id in this push AND
      // we've already cached their avatar from some earlier, unrelated screen (chat, profile, a
      // past call). Either being absent just means the lock-screen falls back to initials, same
      // as it does today.
      val callerId = metadata.optString("callerId").ifBlank { null }
      val callerAvatar = loadCachedCallerAvatar(callerId)

      // Acquire wake lock to wake device
      val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
      val wakeLock = powerManager?.newWakeLock(
        PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
        "Lotus:IncomingCall"
      )
      wakeLock?.acquire(10000)

      val fullScreenActivityIntent = Intent(this, IncomingCallActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("callId", callId)
        putExtra("callerName", callerName)
        putExtra("callType", callType)
        putExtra("isIncomingCall", true)
        putExtra("actionUrl", actionUrl)
        putExtra("channelId", channelId)
        putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName)
        putExtra(IncomingCallActivity.EXTRA_CALL_TYPE, callType)
        putExtra(IncomingCallActivity.EXTRA_ACTION_URL, actionUrl)
        putExtra(IncomingCallActivity.EXTRA_CHANNEL_ID, channelId)
        putExtra(IncomingCallActivity.EXTRA_STARTED_FROM_LOCKED_SCREEN, isLockedAtNotification)
        putExtra(IncomingCallActivity.EXTRA_RING_DEADLINE, System.currentTimeMillis() + IncomingCallActivity.RING_TIMEOUT_MS)
        putExtra(IncomingCallActivity.EXTRA_CALLER_ID, callerId ?: "")
        if (callerAvatar != null) {
          putExtra(IncomingCallActivity.EXTRA_CALLER_PICTURE_PATH, callerAvatar.path)
        }
      }

      val fullScreenIntent = PendingIntent.getActivity(
        this,
        callId.hashCode(),
        fullScreenActivityIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      // Build notification
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      if (notificationManager == null) {
        Log.w(TAG, "NotificationManager unavailable")
        wakeLock?.release()
        return
      }

      val answerLaunchIntent =
        if (!appForegroundAtNotification) packageManager.getLaunchIntentForPackage(packageName)?.apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
          putExtra("callId", callId)
          putExtra("callAction", "answer")
          putExtra("callerName", callerName)
          putExtra("callType", callType)
          putExtra("isIncomingCall", true)
          putExtra("actionUrl", actionUrl)
          putExtra("channelId", channelId)
          putExtra("fromBackgroundNotification", true)
          putExtra("autoJoinCall", true)
          putExtra("answeredFromLockedScreen", isLockedAtNotification)
          CallLaunchGuard.stamp(this@LotusIncomingCallMessagingService, this)
        } else null
      val answerPendingIntent = if (answerLaunchIntent != null) {
        PendingIntent.getActivity(
          this,
          callId.hashCode() + 1,
          answerLaunchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      } else {
        val answerIntent = Intent(this, IncomingCallNotificationReceiver::class.java).apply {
          action = IncomingCallNotificationReceiver.ACTION_ANSWER_CALL
          putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_ID, callId)
          putExtra(IncomingCallNotificationReceiver.EXTRA_CALLER_NAME, callerName)
          putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_TYPE, callType)
          putExtra(IncomingCallNotificationReceiver.EXTRA_ACTION_URL, actionUrl)
          putExtra(IncomingCallNotificationReceiver.EXTRA_CHANNEL_ID, channelId)
          putExtra(IncomingCallNotificationReceiver.EXTRA_ANSWERED_FROM_LOCKED_SCREEN, isLockedAtNotification)
        }
        PendingIntent.getBroadcast(
          this,
          callId.hashCode() + 1,
          answerIntent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      }

      // Decline is handled by the BroadcastReceiver without opening the app UI.
      val declineIntent = Intent(this, IncomingCallNotificationReceiver::class.java).apply {
        action = IncomingCallNotificationReceiver.ACTION_DECLINE_CALL
        putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallNotificationReceiver.EXTRA_CALLER_NAME, callerName)
        putExtra(IncomingCallNotificationReceiver.EXTRA_CALL_TYPE, callType)
        putExtra(IncomingCallNotificationReceiver.EXTRA_ACTION_URL, actionUrl)
      }
      val declinePendingIntent = PendingIntent.getBroadcast(
        this,
        callId.hashCode() + 2,
        declineIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val canUseFullScreen = canUseFullScreenIntent(notificationManager)
      if (!canUseFullScreen) {
        Log.w(TAG, "Full-screen intent permission denied; showing CallStyle notification only")
      }

      val caller = Person.Builder()
        .setName(callerName)
        .setImportant(true)
        .apply {
          if (callerAvatar != null) {
            setIcon(IconCompat.createWithBitmap(callerAvatar.bitmap))
          }
        }
        .build()

      // Build notification - sound is controlled by the notification channel
      // (IncomingCallNotificationHelper creates channel with ringtone)
      val notification = NotificationCompat.Builder(this, IncomingCallNotificationHelper.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_call)
        .setContentTitle(callerName)
        .setContentText(callTypeText)
        .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePendingIntent, answerPendingIntent))
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setFullScreenIntent(fullScreenIntent, canUseFullScreen)
        .setContentIntent(fullScreenIntent)
        .setAutoCancel(false)
        .setOngoing(true)
        .setTimeoutAfter(IncomingCallActivity.RING_TIMEOUT_MS)
        .setWhen(System.currentTimeMillis())
        .setShowWhen(false)
        .setVibrate(longArrayOf(0, 1000, 500, 1000))
        .build()

      // Show as heads-up notification
      notificationManager.notify(callId.hashCode(), notification)
      Log.i(TAG, "Direct call notification shown")

      val mainHandler = Handler(Looper.getMainLooper())

      // Release wake lock after 5 seconds
      mainHandler.postDelayed({
        wakeLock?.release()
      }, 5000)

      reportRingStatus(callId)

    } catch (ex: Exception) {
      Log.e(TAG, "Error in showDirectCallNotification", ex)
      safeRecordException("showDirectCallNotification failed", ex)
      // Fallback to simple notification
      showFallbackNotification(
        data["callId"] ?: data["relatedEntityId"] ?: "",
        data["msg_title"] ?: "Lotus Caller",
        false
      )
    }
  }

  private data class CachedAvatar(val path: String, val bitmap: Bitmap)

  /**
   * A caller's avatar, if the backend sent their user id in this push's metadata AND we've
   * already cached their picture from some earlier, unrelated screen — this service runs fully
   * native (no JS, no Zero) so it has no other way to learn what anyone looks like. Never throws;
   * any failure (no id, no cache entry, file missing, corrupt image) is just a cache miss.
   */
  private fun loadCachedCallerAvatar(callerId: String?): CachedAvatar? {
    if (callerId.isNullOrBlank()) return null
    val path = CallNotificationDataModule.getCachedAvatarPath(this, callerId) ?: return null
    val bitmap = decodeCallerAvatarFile(path) ?: return null
    return CachedAvatar(path, bitmap)
  }

  /**
   * Tells the caller this device has the call — RINGING ("Calling…" becomes "Ringing…"), or BUSY
   * ("On another call") when you already are on one — the same POST /calls/:callId/ring-status
   * the dashboard's Zero mutator mirrors. Done here because this
   * service is the one place every Android incoming call passes through, foreground or killed,
   * with no JS running. Best-effort: it runs on its own thread so a slow network never holds up
   * this FCM thread (a CALL_DISMISS may be queued right behind), and it never throws. The ring is
   * already showing by the time this runs. Signed out (no stored auth) → skipped.
   */
  private fun reportRingStatus(callId: String) {
    // Same stored auth the Decline action uses (written by AuthContextModule on sign-in).
    val authPrefs = getSharedPreferences("XyneAuthContext", Context.MODE_PRIVATE)
    val authToken = authPrefs.getString("auth_token", null)
    val apiBaseUrl = authPrefs.getString("api_base_url", null)
    if (authToken.isNullOrBlank() || apiBaseUrl.isNullOrBlank()) return
    val ringStatus = if (isOnAnotherCall()) "BUSY" else "RINGING"
    val appContext = applicationContext
    Thread {
      try {
        val response = MtlsNetworkClient(appContext).makeMtlsRequest(
          urlString = "$apiBaseUrl/calls/$callId/ring-status",
          method = "POST",
          headers = mapOf(
            "Authorization" to "Bearer " + authToken,
            "Content-Type" to "application/json"
          ),
          body = JSONObject().put("ringStatus", ringStatus).toString()
        )
        Log.d(TAG, "Ring status " + ringStatus + " reported: " + response.statusCode)
      } catch (ex: Exception) {
        Log.w(TAG, "Ring status report failed: " + ex.message)
      }
    }.start()
  }

  /**
   * Already in a call: a SIM call (MODE_IN_CALL) or a VoIP one — another app's or ours
   * (MODE_IN_COMMUNICATION). Reading the audio mode needs no permission, unlike the phone state.
   */
  private fun isOnAnotherCall(): Boolean {
    val mode = (getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.mode ?: return false
    return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION
  }

  private fun canUseFullScreenIntent(notificationManager: NotificationManager): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      notificationManager.canUseFullScreenIntent()
    } else {
      true
    }
  }

  private fun isDeviceLocked(): Boolean =
    (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked == true

  private fun closeIncomingCallUi(callId: String) {
    try {
      val closeIntent = Intent(IncomingCallActivity.ACTION_CLOSE).apply {
        setPackage(packageName)
        putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
      }
      sendBroadcast(closeIntent)
    } catch (ex: Exception) {
      Log.w(TAG, "Failed to close incoming call UI: " + ex.message)
    }
  }

  private fun isAppInForeground(): Boolean {
    try {
      val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      val appProcesses = activityManager?.runningAppProcesses
      if (appProcesses != null) {
        val packageName = packageName
        for (appProcess in appProcesses) {
          if (appProcess.processName == packageName) {
            val isForeground = appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            Log.d(TAG, "Process importance: " + appProcess.importance + ", isForeground=" + isForeground)
            return isForeground
          }
        }
      }
    } catch (ex: Exception) {
      Log.e(TAG, "Error checking foreground status: " + ex.message)
      safeRecordException("isAppInForeground check failed", ex)
    }
    return false
  }

  private fun showNativeIncomingCall(data: Map<String, String>) {
    Log.d(TAG, "showNativeIncomingCall START")

    try {
      val metadata = parseMetadata(data["metadata"])
      val callId = metadata.optString("callId").ifBlank {
        data["callId"] ?: data["relatedEntityId"] ?: ""
      }

      if (callId.isBlank()) {
        Log.w(TAG, "No callId found, cannot show incoming call")
        return
      }

      val callerName = metadata.optString("callerName").ifBlank {
        data["msg_title"] ?: "Lotus Caller"
      }
      val hasVideo = metadata.optString("callType").equals("VIDEO", ignoreCase = true)

      // Run on main thread
      Handler(Looper.getMainLooper()).post {
        try {
          val telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
          if (telecomManager == null) {
            Log.w(TAG, "TelecomManager unavailable, using fallback notification")
            showFallbackNotification(callId, callerName, hasVideo)
            return@post
          }

          val appName = applicationInfo?.loadLabel(packageManager)?.toString() ?: "Lotus"
          val phoneAccountHandle = PhoneAccountHandle(
            ComponentName(this, VoiceConnectionService::class.java),
            appName
          )

          val extras = Bundle().apply {
            putString(Constants.EXTRA_CALL_UUID, callId)
            putString(Constants.EXTRA_CALL_NUMBER, callId)
            putString(Constants.EXTRA_CALLER_NAME, callerName)
            putBoolean(Constants.EXTRA_HAS_VIDEO, hasVideo)
            putBundle(Constants.EXTRA_PAYLOAD, Bundle().apply {
              for ((key, value) in data) {
                putString(key, value)
              }
            })
          }

          // addNewIncomingCall validates the app-owned account itself. Avoid preflighting with
          // getPhoneAccount, which requires the unrelated READ_PHONE_NUMBERS permission on API 31+.
          telecomManager.addNewIncomingCall(phoneAccountHandle, extras)
          Log.i(TAG, "Native incoming call displayed")
        } catch (error: Throwable) {
          Log.e(TAG, "Failed to display native incoming call", error)
          safeRecordException("showNativeIncomingCall telecom failed", error)
          showFallbackNotification(callId, callerName, hasVideo)
        }
      }
    } catch (ex: Exception) {
      Log.e(TAG, "Error in showNativeIncomingCall", ex)
      safeRecordException("showNativeIncomingCall failed", ex)
      showFallbackNotification(
        data["callId"] ?: data["relatedEntityId"] ?: "",
        data["msg_title"] ?: "Lotus Caller",
        false
      )
    }
  }

  private fun showFallbackNotification(callId: String, callerName: String, hasVideo: Boolean) {
    Log.d(TAG, "showFallbackNotification")
    try {
      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      if (notificationManager == null) {
        Log.w(TAG, "NotificationManager unavailable")
        return
      }
      val launchIntent = Intent(this, IncomingCallActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName)
        putExtra(IncomingCallActivity.EXTRA_CALL_TYPE, if (hasVideo) "VIDEO" else "AUDIO")
        putExtra(IncomingCallActivity.EXTRA_STARTED_FROM_LOCKED_SCREEN, isDeviceLocked())
      }
      val pendingIntent = PendingIntent.getActivity(
        this, callId.hashCode(), launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = NotificationCompat.Builder(this, IncomingCallNotificationHelper.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_call)
        .setContentTitle("Incoming Call")
        .setContentText("$callerName is calling")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setFullScreenIntent(pendingIntent, true)
        .setContentIntent(pendingIntent)
        .setAutoCancel(false)
        .setOngoing(true)
        .setTimeoutAfter(IncomingCallActivity.RING_TIMEOUT_MS)
        .build()
      notificationManager.notify(callId.hashCode(), notification)
      Log.i(TAG, "Fallback notification shown")
    } catch (ex: Exception) {
      Log.e(TAG, "Error showing fallback notification", ex)
      safeRecordException("showFallbackNotification failed", ex)
    }
  }

  private fun hasDisplayableNotificationContent(data: Map<String, String>): Boolean {
    fun nonEmpty(key: String): Boolean = data[key]?.trim()?.isNotEmpty() == true
    return nonEmpty("msg_title") ||
      nonEmpty("title") ||
      nonEmpty("msg_body") ||
      nonEmpty("body") ||
      nonEmpty("message")
  }

  private fun shouldSkipExpoDisplayForward(data: Map<String, String>): Boolean {
    val type = data["type"]
    val callTypesNeedingExpoForward = setOf("INCOMING_CALL", "CALL_DISMISS", "MISSED_CALL", "ONGOING_CALL")
    if (type != null && callTypesNeedingExpoForward.contains(type)) {
      return false
    }
    return !hasDisplayableNotificationContent(data)
  }

  private fun forwardToExpoNotifications(remoteMessage: RemoteMessage) {
    Log.d(TAG, "forwardToExpoNotifications")
    try {
      // expo-notifications expects "title" and "message" keys in data
      // but backend sends "msg_title" and "msg_body"
      // We need to create a modified RemoteMessage with the correct keys
      val modifiedData = HashMap(remoteMessage.data)

      if (shouldSkipExpoDisplayForward(modifiedData)) {
        Log.d(TAG, "Silent notification (no title/body), skipping expo display forward")
        return
      }

      // Map msg_title/msg_body to title/message for expo-notifications
      if (modifiedData.containsKey("msg_title") && !modifiedData.containsKey("title")) {
        modifiedData["title"] = modifiedData["msg_title"]!!
      }
      if (modifiedData.containsKey("msg_body")) {
        val metadata = parseMetadata(modifiedData["metadata"])
        val body = formatBodyWithSenderName(modifiedData["msg_body"]!!.trim(), metadata)
        modifiedData["msg_body"] = body
        if (!modifiedData.containsKey("message")) {
          modifiedData["message"] = body
        }
      }

      // Create a new RemoteMessage with modified data
      val newMessage = RemoteMessage.Builder(remoteMessage.from ?: "")
        .setMessageId(remoteMessage.messageId ?: "")
        .setData(modifiedData)
        .build()

      // FirebaseMessagingDelegate.onMessageReceived always calls runTaskManagerTasks.
      // In background/killed, Expo TaskService then does getAppLoader().loadApp()
      // (TaskService.java:426). getAppLoader() is null when the JS host is not
      // mounted (WeakReference context gone, or Airborne headless loader missing)
      // → NullPointerException. Present the tray item without spinning TaskManager.
      // Foreground is safe: TaskManager is already registered, so no headless load.
      if (isAppInForeground()) {
        val delegate = expo.modules.notifications.service.delegates.FirebaseMessagingDelegate(this)
        delegate.onMessageReceived(newMessage)
        Log.d(TAG, "Forwarded to FirebaseMessagingDelegate with mapped keys")
      } else {
        presentExpoNotificationWithoutTaskManager(newMessage)
        Log.d(TAG, "Presented expo notification without TaskManager (background)")
      }
    } catch (ex: Exception) {
      Log.e(TAG, "Failed to forward via delegate: " + ex.message, ex)
      safeRecordException("forwardToExpoNotifications failed", ex)
    }
  }

  /**
   * Same presentation path as FirebaseMessagingDelegate.onMessageReceived, but
   * skips runTaskManagerTasks. That TaskManager path NPEs when the headless
   * AppLoader is unavailable (background / killed process).
   */
  private fun presentExpoNotificationWithoutTaskManager(remoteMessage: RemoteMessage) {
    val identifier = remoteMessage.data["tag"]
      ?: remoteMessage.messageId
      ?: java.util.UUID.randomUUID().toString()
    val content = expo.modules.notifications.notifications.model.RemoteNotificationContent(remoteMessage)
    val trigger = expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger(remoteMessage)
    val request = expo.modules.notifications.notifications.model.NotificationRequest(
      identifier,
      content,
      trigger,
    )
    val notification = expo.modules.notifications.notifications.model.Notification(
      request,
      java.util.Date(remoteMessage.sentTime),
    )
    expo.modules.notifications.service.NotificationsService.receive(this, notification)
  }

  private fun launchCallActivity(data: Map<String, String>) {
    Log.d(TAG, "launchCallActivity")
    try {
      val metadata = parseMetadata(data["metadata"])
      val callId = metadata.optString("callId").ifBlank {
        data["callId"] ?: data["relatedEntityId"] ?: ""
      }
      val callerName = metadata.optString("callerName").ifBlank {
        data["msg_title"] ?: "Lotus Caller"
      }

      if (callId.isBlank()) {
        Log.w(TAG, "No callId found, cannot launch call activity")
        return
      }

      val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        putExtra("callId", callId)
        putExtra("callerName", callerName)
        putExtra("callType", metadata.optString("callType", "AUDIO"))
        putExtra("isIncomingCall", true)
        putExtra("actionUrl", data["actionUrl"])
        CallLaunchGuard.stamp(this@LotusIncomingCallMessagingService, this)
      }

      if (intent != null) {
        startActivity(intent)
        Log.i(TAG, "Launched main activity for incoming call")
      } else {
        Log.w(TAG, "Could not get launch intent")
      }
    } catch (ex: Exception) {
      Log.e(TAG, "Error launching call activity", ex)
      safeRecordException("launchCallActivity failed", ex)
    }
  }

  private fun parseMetadata(metadataRaw: String?): JSONObject {
    if (metadataRaw.isNullOrBlank()) return JSONObject()
    return try {
      JSONObject(metadataRaw)
    } catch (_: Throwable) {
      JSONObject()
    }
  }

  /** Prepend sender for non-DM channel notifications (matches backend desktop + JS display). */
  private fun formatBodyWithSenderName(body: String, metadata: JSONObject): String {
    val senderName = metadata.optString("senderName").trim()
    val scopeType = metadata.optString("scopeType").trim()
    if (senderName.isEmpty() || scopeType == "DM") {
      return body
    }
    val prefix = "$senderName: "
    return if (body.startsWith(prefix)) body else prefix + body
  }

  private fun dismissCallNotification(data: Map<String, String>) {
    try {
      val metadata = parseMetadata(data["metadata"])
      val callId = metadata.optString("callId").ifBlank {
        data["callId"] ?: data["relatedEntityId"] ?: ""
      }

      if (callId.isBlank()) {
        Log.w(TAG, "No callId found, cannot dismiss notification")
        return
      }

      val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: return

      notificationManager.cancel(callId.hashCode())
      closeIncomingCallUi(callId)
      Log.i(TAG, "Dismissed incoming call notification")
    } catch (ex: Exception) {
      Log.e(TAG, "Error dismissing notification", ex)
      safeRecordException("dismissCallNotification failed", ex)
    }
  }

  private fun safeRecordException(message: String, e: Throwable) {
    try {
      com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance().apply {
        log(message)
        recordException(e)
      }
    } catch (firebaseEx: Exception) {
      Log.w(TAG, "Crashlytics not available: " + firebaseEx.message)
    }
  }

  companion object {
    private const val TAG = "LotusIncomingCallSvc"

    /** FCM chat types owned by NotificationV3 (Notifee) — do not forward to expo-notifications. */
    private val CHAT_MESSAGE_TYPES = setOf(
      "CHANNEL_MESSAGE",
      "DIRECT_MESSAGE",
      "THREAD_REPLY",
      "MENTION",
    )
  }
}
`;
}

function withNativeIncomingCallAndroid(config) {
  // ── Step 1: Write all Kotlin source files ──────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    modConfig => {
      const androidPackage = modConfig?.android?.package;
      if (!androidPackage) {
        return modConfig;
      }

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

      // ── Incoming call notification files ──────────────────────────────────
      fs.writeFileSync(
        path.join(javaDir, 'LotusIncomingCallMessagingService.kt'),
        buildServiceSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'IncomingCallNotificationHelper.kt'),
        buildNotificationHelperSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'LaunchIntentModule.kt'),
        buildLaunchIntentModuleSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'CallLaunchGuard.kt'),
        buildCallLaunchGuardSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'IncomingCallNotificationReceiver.kt'),
        buildBroadcastReceiverSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'IncomingCallActivity.kt'),
        buildIncomingCallActivitySource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'IncomingCallUiModule.kt'),
        buildIncomingCallUiModuleSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'IncomingCallUiPackage.kt'),
        buildIncomingCallUiPackageSource(androidPackage),
      );

      // ── VoIP foreground service (ongoing call) files ──────────────────────
      fs.writeFileSync(
        path.join(javaDir, 'VoIPForegroundService.kt'),
        buildVoIPForegroundServiceSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'VoIPForegroundServiceModule.kt'),
        buildVoIPForegroundServiceModuleSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'VoIPForegroundServicePackage.kt'),
        buildVoIPForegroundServicePackageSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'VoIPCallActionReceiver.kt'),
        buildVoIPCallActionReceiverSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'AuthContextModule.kt'),
        buildAuthContextModuleSource(androidPackage),
      );
      fs.writeFileSync(
        path.join(javaDir, 'AuthContextPackage.kt'),
        buildAuthContextPackageSource(androidPackage),
      );

      // ── Resource files ────────────────────────────────────────────────────
      const resDir = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'res',
      );

      // layout/notification_ongoing_call.xml
      const layoutDir = path.join(resDir, 'layout');
      ensureDirectory(layoutDir);
      fs.writeFileSync(
        path.join(layoutDir, 'notification_ongoing_call.xml'),
        buildNotificationLayoutXml(),
      );
      // layout/notification_incoming_call.xml
      fs.writeFileSync(
        path.join(layoutDir, 'notification_incoming_call.xml'),
        buildNotificationIncomingCallLayoutXml(),
      );

      // drawable/ic_call_end.xml
      const drawableDir = path.join(resDir, 'drawable');
      ensureDirectory(drawableDir);
      fs.writeFileSync(path.join(drawableDir, 'ic_call_end.xml'), buildIcCallEndDrawableSimple());

      // drawable/bg_end_call_button.xml  (red circle — decline/end)
      fs.writeFileSync(
        path.join(drawableDir, 'bg_end_call_button.xml'),
        buildBgEndCallButtonDrawable(),
      );

      // drawable/bg_answer_button.xml  (green circle — answer)
      fs.writeFileSync(
        path.join(drawableDir, 'bg_answer_button.xml'),
        buildBgAnswerButtonDrawable(),
      );

      // drawable/ic_phone_answer.xml  (white phone icon)
      fs.writeFileSync(path.join(drawableDir, 'ic_phone_answer.xml'), buildIcPhoneAnswerDrawable());

      // values/colors.xml — patch in colorEndCall
      const valuesDir = path.join(resDir, 'values');
      ensureDirectory(valuesDir);
      const colorsPath = path.join(valuesDir, 'colors.xml');
      let colorsXml = readFileIfExists(colorsPath);
      if (colorsXml !== null) {
        if (!colorsXml.includes('colorEndCall')) {
          colorsXml = colorsXml.replace(
            '</resources>',
            '  <color name="colorEndCall">#E53935</color>\n</resources>',
          );
          fs.writeFileSync(colorsPath, colorsXml);
        }
      } else {
        fs.writeFileSync(
          colorsPath,
          '<resources>\n  <color name="colorEndCall">#E53935</color>\n</resources>\n',
        );
      }

      const stylesPath = path.join(valuesDir, 'styles.xml');
      const incomingCallStyle = `  <style name="IncomingCallActivityTheme" parent="@android:style/Theme.Material.NoActionBar">
    <item name="android:windowNoTitle">true</item>
    <item name="android:windowActionBar">false</item>
    <item name="android:windowFullscreen">true</item>
    <item name="android:windowIsTranslucent">false</item>
    <item name="android:windowDisablePreview">true</item>
  </style>`;
      let stylesXml = readFileIfExists(stylesPath);
      if (stylesXml !== null) {
        if (!stylesXml.includes('IncomingCallActivityTheme')) {
          stylesXml = stylesXml.replace('</resources>', `${incomingCallStyle}\n</resources>`);
          fs.writeFileSync(stylesPath, stylesXml);
        }
      } else {
        fs.writeFileSync(stylesPath, `<resources>\n${incomingCallStyle}\n</resources>\n`);
      }

      // ── AndroidManifest.xml ───────────────────────────────────────────────
      const manifestPath = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'AndroidManifest.xml',
      );
      let contents = readFileIfExists(manifestPath);
      if (contents === null) {
        return modConfig;
      }

      const requiredPermissions = [
        '<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>',
        '<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>',
      ];
      for (const permission of requiredPermissions) {
        const permissionName = permission.match(/android\.permission\.[A-Z_]+/)?.[0];
        if (permissionName && !contents.includes(permissionName)) {
          contents = contents.replace('<application', `${permission}\n    <application`);
        }
      }

      // Incoming call FCM service
      const fcmServiceDecl = `    <service
      android:name=".LotusIncomingCallMessagingService"
      android:exported="false">
      <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT"/>
      </intent-filter>
    </service>`;
      if (!contents.includes('LotusIncomingCallMessagingService')) {
        contents = contents.replace('</application>', `${fcmServiceDecl}\n  </application>`);
      }

      // Incoming call dismiss/decline receiver
      const incomingReceiverDecl = `    <receiver
      android:name=".IncomingCallNotificationReceiver"
      android:exported="false" />`;
      if (!contents.includes('IncomingCallNotificationReceiver')) {
        contents = contents.replace('</application>', `${incomingReceiverDecl}\n  </application>`);
      }

      const incomingActivityDecl = `    <activity
      android:name=".IncomingCallActivity"
      android:exported="false"
      android:excludeFromRecents="true"
      android:launchMode="singleTop"
      android:taskAffinity="\${applicationId}.incomingCall"
      android:showWhenLocked="true"
      android:turnScreenOn="true"
      android:theme="@style/IncomingCallActivityTheme" />`;
      const incomingActivityPattern =
        / {4}<activity\b(?=[^>]*android:name="\.IncomingCallActivity")[^>]*\/>/s;
      if (incomingActivityPattern.test(contents)) {
        contents = contents.replace(incomingActivityPattern, incomingActivityDecl);
      } else {
        contents = contents.replace('</application>', `${incomingActivityDecl}\n  </application>`);
      }

      // FOREGROUND_SERVICE_MICROPHONE permission (required on Android 14 / API 34+)
      if (!contents.includes('FOREGROUND_SERVICE_MICROPHONE')) {
        contents = contents.replace(
          '<application',
          '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" tools:targetApi="34" />\n    <application',
        );
      }

      // VoIP foreground service (ongoing call + recording)
      // foregroundServiceType="microphone" is required for LiveKit audio to keep
      // working when the app is backgrounded or the screen is locked; "phoneCall" keeps
      // a call joined without mic access alive (FOREGROUND_SERVICE_PHONE_CALL + MANAGE_OWN_CALLS
      // come from withCallKeepAndroidManifest).
      const voipServiceDecl = `    <service
      android:name=".VoIPForegroundService"
      android:exported="false"
      android:foregroundServiceType="microphone|phoneCall" />`;
      const voipServicePattern = /\s*<service\s+android:name="\.VoIPForegroundService"[\s\S]*?\/>/;
      if (voipServicePattern.test(contents)) {
        contents = contents.replace(voipServicePattern, `\n${voipServiceDecl}`);
      } else {
        contents = contents.replace('</application>', `${voipServiceDecl}\n  </application>`);
      }

      // VoIP end-call action receiver
      const voipReceiverDecl = `    <receiver
      android:name=".VoIPCallActionReceiver"
      android:exported="false" />`;
      if (!contents.includes('VoIPCallActionReceiver')) {
        contents = contents.replace('</application>', `${voipReceiverDecl}\n  </application>`);
      }

      fs.writeFileSync(manifestPath, contents);

      return modConfig;
    },
  ]);

  // ── Step 2: Patch MainActivity ────────────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    modConfig => {
      const androidPackage = modConfig?.android?.package;
      if (!androidPackage) return modConfig;

      const mainActivityPath = path.join(
        modConfig.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        toPackagePath(androidPackage),
        'MainActivity.kt',
      );

      let mainActivityContents = readFileIfExists(mainActivityPath);
      if (mainActivityContents !== null) {
        let contents = mainActivityContents;
        const lockScreenHelperSource = `
  private fun isAnsweredCallLaunch(intent: android.content.Intent?): Boolean {
    val extras = intent?.extras ?: return false
    val callAction = extras.getString("callAction")
    @Suppress("DEPRECATION")
    val autoJoinCallValue = extras.get("autoJoinCall")
    val autoJoinCallFromString =
      (autoJoinCallValue as? String)?.equals("true", ignoreCase = true) == true
    val autoJoinCall = extras.getBoolean("autoJoinCall", false) ||
      autoJoinCallFromString
    return extras.getBoolean("isIncomingCall", false) && (callAction == "answer" || autoJoinCall)
  }

  private fun applyAnsweredCallLockScreenFlags(intent: android.content.Intent?) {
    if (!isAnsweredCallLaunch(intent)) return

    if (!shouldShowAnsweredCallOverLockScreen(intent)) {
      clearAnsweredCallLockScreenFlags()
      return
    }

    android.util.Log.d("LaunchIntent", "Applying lock-screen flags for locked incoming call")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }

    window.addFlags(
      android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
    )
  }

  private fun wasAnsweredFromLockedScreen(intent: android.content.Intent?): Boolean {
    val extras = intent?.extras ?: return false
    return isAnsweredCallLaunch(intent) && extras.getBoolean("answeredFromLockedScreen", false)
  }

  private fun isDeviceLocked(): Boolean =
    (getSystemService(android.content.Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager)
      ?.isKeyguardLocked == true

  private fun shouldShowAnsweredCallOverLockScreen(intent: android.content.Intent?): Boolean =
    wasAnsweredFromLockedScreen(intent) && isDeviceLocked()

  private fun clearAnsweredCallLockScreenFlags() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(false)
      setTurnScreenOn(false)
    } else {
      @Suppress("DEPRECATION")
      window.clearFlags(
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.clearFlags(
      android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
    )
  }

  private fun syncAnsweredCallLockScreenFlags() {
    if (isAnsweredCallLaunch(intent)) {
      applyAnsweredCallLockScreenFlags(intent)
    }
  }

  private fun shouldReturnToKeyguardOnBack(): Boolean =
    wasAnsweredFromLockedScreen(intent) && isDeviceLocked()

  private fun returnToKeyguardFromAnsweredCall(): Boolean {
    if (!shouldReturnToKeyguardOnBack()) return false

    android.util.Log.d("LaunchIntent", "Returning locked answered call to keyguard")
    clearAnsweredCallLockScreenFlags()
    moveTaskToBack(true)
    return true
  }

  private fun installAnsweredCallBackGuard() {
    onBackPressedDispatcher.addCallback(
      this,
      object : androidx.activity.OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (returnToKeyguardFromAnsweredCall()) return

          isEnabled = false
          try {
            onBackPressedDispatcher.onBackPressed()
          } finally {
            isEnabled = true
          }
        }
      }
    )
  }

  override fun onResume() {
    super.onResume()
    syncAnsweredCallLockScreenFlags()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      syncAnsweredCallLockScreenFlags()
    }
  }`;

        if (!contents.includes('launchIntentExtras')) {
          // Add companion object with static storage
          contents = contents.replace(
            /(class MainActivity : ReactActivity\(\) \{)/,
            `$1

  companion object {
    // Static storage for launch intent extras — persists across React reloads
    var launchIntentExtras: android.os.Bundle? = null
      private set

    fun clearLaunchIntentExtras() {
      launchIntentExtras = null
    }
  }`,
          );

          // Capture extras before super.onCreate
          contents = contents.replace(
            /(super\.onCreate\(null\))/,
            `    applyAnsweredCallLockScreenFlags(intent)

    // Capture launch intent extras BEFORE calling super.onCreate
    android.util.Log.d("LaunchIntent", "onCreate received; hasIntent=" + (intent != null) + ", hasExtras=" + (intent?.extras != null))
    if (intent != null && intent.extras != null) {
      val extras = intent.extras!!
      launchIntentExtras = android.os.Bundle(extras)
      android.util.Log.d("LaunchIntent", "Captured launch intent; hasCallId=" + !extras.getString("callId").isNullOrBlank() + ", action=" + extras.getString("callAction"))

      val callData = mapOf(
        "callId" to extras.getString("callId"),
        "callAction" to extras.getString("callAction"),
        "callerName" to extras.getString("callerName"),
        "callType" to extras.getString("callType"),
        "channelId" to extras.getString("channelId"),
        "isIncomingCall" to extras.getBoolean("isIncomingCall", false).toString(),
        "actionUrl" to extras.getString("actionUrl")
      )
      extras.getString("callId")?.let { incomingCallId ->
        (getSystemService(android.content.Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager)
          ?.cancel(incomingCallId.hashCode())
        sendBroadcast(android.content.Intent(IncomingCallActivity.ACTION_CLOSE).apply {
          setPackage(packageName)
          putExtra(IncomingCallActivity.EXTRA_CALL_ID, incomingCallId)
        })
      }
      CallNotificationDataModule.storeCallData(this, callData)
    } else {
      launchIntentExtras = null
      android.util.Log.d("LaunchIntent", "No intent extras to capture; cleared sticky launch extras")
    }

    $1
    installAnsweredCallBackGuard()`,
          );

          // Add onNewIntent to handle taps when app is already running
          if (!contents.includes('override fun onNewIntent')) {
            contents = contents.replace(
              /(override fun invokeDefaultOnBackPressed)/,
              `  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    applyAnsweredCallLockScreenFlags(intent)
    android.util.Log.d("LaunchIntent", "onNewIntent received; hasExtras=" + (intent.extras != null))
    if (intent.extras != null) {
      val extras = intent.extras!!
      launchIntentExtras = android.os.Bundle(extras)
      android.util.Log.d("LaunchIntent", "onNewIntent captured; hasCallId=" + !extras.getString("callId").isNullOrBlank() + ", action=" + extras.getString("callAction"))

      val callData = mapOf(
        "callId" to extras.getString("callId"),
        "callAction" to extras.getString("callAction"),
        "callerName" to extras.getString("callerName"),
        "callType" to extras.getString("callType"),
        "channelId" to extras.getString("channelId"),
        "isIncomingCall" to extras.getBoolean("isIncomingCall", false).toString(),
        "actionUrl" to extras.getString("actionUrl")
      )
      extras.getString("callId")?.let { incomingCallId ->
        (getSystemService(android.content.Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager)
          ?.cancel(incomingCallId.hashCode())
        sendBroadcast(android.content.Intent(IncomingCallActivity.ACTION_CLOSE).apply {
          setPackage(packageName)
          putExtra(IncomingCallActivity.EXTRA_CALL_ID, incomingCallId)
        })
      }
      CallNotificationDataModule.storeCallData(this, callData)
    } else {
      launchIntentExtras = null
      android.util.Log.d("LaunchIntent", "onNewIntent had no extras; cleared sticky launch extras")
    }
  }

  $1`,
            );
          } else {
            // Fix nullable signature if it slipped in
            contents = contents.replace(
              /override fun onNewIntent\(intent: android\.content\.Intent\?\)/g,
              'override fun onNewIntent(intent: android.content.Intent)',
            );
            contents = contents.replace(
              /if \(intent != null && intent\.extras != null\)/g,
              'if (intent.extras != null)',
            );
          }
        }

        // Existing generated projects may already contain the old diagnostics. Keep
        // this migration outside the insertion guard so incremental prebuilds do not
        // retain whole Intent/Bundle or call-id payloads in logcat.
        contents = sanitizeLegacyLaunchIntentLogs(contents);

        if (!contents.includes('private fun isAnsweredCallLaunch')) {
          contents = contents.replace(
            /\n {2}\/\*\*\n {3}\* Returns the name of the main component/,
            `\n${lockScreenHelperSource}\n\n  /**\n   * Returns the name of the main component`,
          );
        }

        if (!contents.includes('applyAnsweredCallLockScreenFlags(intent)')) {
          contents = contents.replace(
            /(override fun onCreate\(savedInstanceState: Bundle\?\) \{)/,
            `$1\n    applyAnsweredCallLockScreenFlags(intent)`,
          );
        }

        if (
          contents.includes('override fun onNewIntent(intent: android.content.Intent)') &&
          !/override fun onNewIntent\(intent: android\.content\.Intent\) \{[\s\S]*?applyAnsweredCallLockScreenFlags\(intent\)/.test(
            contents,
          )
        ) {
          contents = contents.replace(
            /(override fun onNewIntent\(intent: android\.content\.Intent\) \{\n\s*super\.onNewIntent\(intent\)\n)(\s*setIntent\(intent\)\n)?/,
            `$1    setIntent(intent)\n    applyAnsweredCallLockScreenFlags(intent)\n`,
          );
        }

        if (
          contents.includes('override fun invokeDefaultOnBackPressed()') &&
          !/override fun invokeDefaultOnBackPressed\(\) \{[\s\S]*?returnToKeyguardFromAnsweredCall\(\)/.test(
            contents,
          )
        ) {
          contents = contents.replace(
            /(override fun invokeDefaultOnBackPressed\(\) \{)/,
            `$1\n      if (returnToKeyguardFromAnsweredCall()) return\n`,
          );
        }

        if (
          contents.includes('private fun shouldReturnToKeyguardOnBack(): Boolean') &&
          !contents.includes('private fun returnToKeyguardFromAnsweredCall()')
        ) {
          contents = contents.replace(
            / {2}private fun shouldReturnToKeyguardOnBack\(\): Boolean =\n {4}wasAnsweredFromLockedScreen\(intent\) && isDeviceLocked\(\)/,
            `  private fun shouldReturnToKeyguardOnBack(): Boolean =
    wasAnsweredFromLockedScreen(intent) && isDeviceLocked()

  private fun returnToKeyguardFromAnsweredCall(): Boolean {
    if (!shouldReturnToKeyguardOnBack()) return false

    android.util.Log.d("LaunchIntent", "Returning locked answered call to keyguard")
    clearAnsweredCallLockScreenFlags()
    moveTaskToBack(true)
    return true
  }

  private fun installAnsweredCallBackGuard() {
    onBackPressedDispatcher.addCallback(
      this,
      object : androidx.activity.OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (returnToKeyguardFromAnsweredCall()) return

          isEnabled = false
          try {
            onBackPressedDispatcher.onBackPressed()
          } finally {
            isEnabled = true
          }
        }
      }
    )
  }`,
          );
        }

        if (!/super\.onCreate\(null\)\n\s*installAnsweredCallBackGuard\(\)/.test(contents)) {
          contents = contents.replace(
            /(super\.onCreate\(null\))/,
            `$1\n    installAnsweredCallBackGuard()`,
          );
        }

        if (
          contents.includes('override fun invokeDefaultOnBackPressed()') &&
          contents.includes('if (shouldReturnToKeyguardOnBack())')
        ) {
          contents = contents.replace(
            /\s*if \(shouldReturnToKeyguardOnBack\(\)\) \{\n\s*moveTaskToBack\(true\)\n\s*return\n\s*\}\n/,
            `\n      if (returnToKeyguardFromAnsweredCall()) return\n`,
          );
        }

        if (
          contents.includes('override fun onResume()') &&
          !contents.includes('override fun onWindowFocusChanged(hasFocus: Boolean)')
        ) {
          contents = contents.replace(
            /( {2}override fun onResume\(\) \{\n {4}super\.onResume\(\)\n {4}syncAnsweredCallLockScreenFlags\(\)\n {2}\})/,
            `$1

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      syncAnsweredCallLockScreenFlags()
    }
  }`,
          );
        }

        // Security (bug bounty #44): drop forged call extras before anything reads them.
        if (!/override fun onCreate\(savedInstanceState: Bundle\?\) \{\n\s*CallLaunchGuard\.sanitize\(this, intent\)/.test(contents)) {
          contents = contents.replace(
            /(override fun onCreate\(savedInstanceState: Bundle\?\) \{\n)/,
            `$1    CallLaunchGuard.sanitize(this, intent)\n`,
          );
        }
        if (
          !/override fun onNewIntent\(intent: android\.content\.Intent\) \{\n\s*super\.onNewIntent\(intent\)\n\s*CallLaunchGuard\.sanitize\(this, intent\)/.test(
            contents,
          )
        ) {
          contents = contents.replace(
            /(override fun onNewIntent\(intent: android\.content\.Intent\) \{\n\s*super\.onNewIntent\(intent\)\n)/,
            `$1    CallLaunchGuard.sanitize(this, intent)\n`,
          );
        }
        if (!contents.includes('CallLaunchGuard.sanitize(this, intent)')) {
          throw new Error(`[${PLUGIN_NAME}] Could not install CallLaunchGuard in MainActivity`);
        }

        fs.writeFileSync(mainActivityPath, contents);
      }

      return modConfig;
    },
  ]);

  // ── Step 3: Patch MainApplication (withDangerousMod runs after withMainApplication) ──
  config = withDangerousMod(config, [
    'android',
    config => {
      const androidPackage = config?.android?.package;
      if (!androidPackage) return config;

      const mainApplicationPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        toPackagePath(androidPackage),
        'MainApplication.kt',
      );

      let mainApplicationContents = readFileIfExists(mainApplicationPath);
      if (mainApplicationContents !== null) {
        let contents = mainApplicationContents;

        // Imports
        const launchIntentImport = `import ${androidPackage}.LaunchIntentPackage`;
        const callNotificationDataImport = `import ${androidPackage}.CallNotificationDataPackage`;
        const voipPackageImport = `import ${androidPackage}.VoIPForegroundServicePackage`;
        const incomingCallUiPackageImport = `import ${androidPackage}.IncomingCallUiPackage`;

        if (!contents.includes('LaunchIntentPackage')) {
          contents = contents.replace(
            /(package .*\n)/,
            `$1\n${launchIntentImport}\n${callNotificationDataImport}\n${voipPackageImport}\n${incomingCallUiPackageImport}\n`,
          );
        } else if (!contents.includes('VoIPForegroundServicePackage')) {
          contents = contents.replace(/(package .*\n)/, `$1\n${voipPackageImport}\n`);
        }
        if (!contents.includes('IncomingCallUiPackage')) {
          contents = contents.replace(/(package .*\n)/, `$1\n${incomingCallUiPackageImport}\n`);
        }

        // Package registrations
        if (!contents.includes('CallNotificationDataPackage()')) {
          contents = contents.replace(
            /(PackageList\(this\)\.packages\.apply \{[\s\S]*?)(\/\/ add\(MyReactNativePackage\(\)\))/,
            `$1              add(LaunchIntentPackage())\n              add(CallNotificationDataPackage())\n              add(VoIPForegroundServicePackage())\n              add(AuthContextPackage())\n              $2`,
          );
        } else if (!contents.includes('VoIPForegroundServicePackage()')) {
          contents = contents.replace(
            /(PackageList\(this\)\.packages\.apply \{[\s\S]*?)(\/\/ add\(MyReactNativePackage\(\)\))/,
            `$1              add(VoIPForegroundServicePackage())\n              add(AuthContextPackage())\n              $2`,
          );
        } else if (!contents.includes('AuthContextPackage()')) {
          contents = contents.replace(
            /(PackageList\(this\)\.packages\.apply \{[\s\S]*?)(\/\/ add\(MyReactNativePackage\(\)\))/,
            `$1              add(AuthContextPackage())\n              $2`,
          );
        }
        if (!contents.includes('IncomingCallUiPackage()')) {
          contents = contents.replace(
            /(PackageList\(this\)\.packages\.apply \{[\s\S]*?)(\/\/ add\(MyReactNativePackage\(\)\))/,
            `$1              add(IncomingCallUiPackage())\n              $2`,
          );
        }

        // AuthContextPackage import
        const authContextImport = `import ${androidPackage}.AuthContextPackage`;
        if (!contents.includes('AuthContextPackage')) {
          contents = contents.replace(/(package .*\n)/, `$1\n${authContextImport}\n`);
        }

        fs.writeFileSync(mainApplicationPath, contents);
      }

      return config;
    },
  ]);

  // ── Step 4: Create package registration files via withMainApplication ─────
  config = withMainApplication(config, config => {
    const androidPackage = config?.android?.package;
    if (!androidPackage) return config;

    const javaDir = path.join(
      config.modRequest.projectRoot,
      'android',
      'app',
      'src',
      'main',
      'java',
      toPackagePath(androidPackage),
    );

    // LaunchIntentPackage
    fs.writeFileSync(
      path.join(javaDir, 'LaunchIntentPackage.kt'),
      `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LaunchIntentPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(LotusLaunchIntentModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`,
    );

    // CallNotificationDataModule
    fs.writeFileSync(
      path.join(javaDir, 'CallNotificationDataModule.kt'),
      buildCallNotificationDataModuleSource(androidPackage),
    );

    // CallNotificationDataPackage
    fs.writeFileSync(
      path.join(javaDir, 'CallNotificationDataPackage.kt'),
      `package ${androidPackage}

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class CallNotificationDataPackage : ReactPackage {
  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<View, ReactShadowNode<*>>> = emptyList()

  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(CallNotificationDataModule(reactContext))
}
`,
    );

    return config;
  });

  return config;
}

function buildCallNotificationDataModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

/**
 * Native module to persist call notification data across app restarts.
 * Stores call data (callId, callAction, etc.) in SharedPreferences when
 * user taps accept/decline from a killed state notification.
 */
class CallNotificationDataModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val PREFS_NAME = "CallNotificationData"
    private const val KEY_CALL_ID = "callId"
    private const val KEY_CALL_ACTION = "callAction"
    private const val KEY_CALLER_NAME = "callerName"
    private const val KEY_CALL_TYPE = "callType"
    // Call credentials were previously persisted here. Keep their names only
    // for one-time cleanup of values written by older app versions.
    private const val LEGACY_TOKEN_KEY = "token"
    private const val LEGACY_SERVER_URL_KEY = "serverUrl"
    private const val KEY_CHANNEL_ID = "channelId"
    private const val KEY_IS_INCOMING_CALL = "isIncomingCall"
    private const val KEY_ACTION_URL = "actionUrl"
    private const val KEY_TIMESTAMP = "timestamp"

    // userId -> local avatar file path, written in batches as JS resolves people's avatars
    // (chat, profile, participant tiles, …). Read by LotusIncomingCallMessagingService,
    // which runs fully native — no JS/Zero to ask — so this is the only way it can know what a
    // caller looks like. A miss (never seen this person's avatar, or the file was since evicted)
    // just means the lock-screen call UI falls back to initials, same as it does today.
    private const val AVATAR_PREFS_NAME = "CallerAvatarCache"

    private var pendingCallData: Map<String, String?>? = null

    /** Native-only read (FCM service), before any Activity or React context exists. */
    @JvmStatic
    fun getCachedAvatarPath(context: Context, userId: String): String? {
      if (userId.isBlank()) return null
      val prefs = context.getSharedPreferences(AVATAR_PREFS_NAME, Context.MODE_PRIVATE)
      return prefs.getString(userId, null)
    }

    /**
     * Store call notification data from MainActivity when notification action launches app.
     * Called from MainActivity.onCreate when app is launched from killed state.
     */
    @JvmStatic
    fun storeCallData(context: Context, data: Map<String, String?>) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val stored = prefs.edit()
        .putString(KEY_CALL_ID, data[KEY_CALL_ID])
        .putString(KEY_CALL_ACTION, data[KEY_CALL_ACTION])
        .putString(KEY_CALLER_NAME, data[KEY_CALLER_NAME])
        .putString(KEY_CALL_TYPE, data[KEY_CALL_TYPE])
        .remove(LEGACY_TOKEN_KEY)
        .remove(LEGACY_SERVER_URL_KEY)
        .putString(KEY_CHANNEL_ID, data[KEY_CHANNEL_ID])
        .putBoolean(KEY_IS_INCOMING_CALL, data[KEY_IS_INCOMING_CALL]?.toBoolean() ?: false)
        .putString(KEY_ACTION_URL, data[KEY_ACTION_URL])
        .putLong(KEY_TIMESTAMP, System.currentTimeMillis())
        .commit()
      if (!stored) {
        android.util.Log.w("CallNotificationData", "Unable to persist call data")
      }

      // Also store in static for immediate access
      pendingCallData = data

      android.util.Log.d("CallNotificationData", "Stored call data; hasCallId=\${!data[KEY_CALL_ID].isNullOrBlank()}, action=\${data[KEY_CALL_ACTION]}")
    }
  }

  override fun getName(): String = "CallNotificationDataModule"

  /**
   * Get the stored call notification data (called from JS on app startup).
   * Returns the data and clears it atomically to prevent duplicate processing.
   */
  @ReactMethod
  fun getCallData(promise: Promise) {
    try {
      // Check static cache first for immediate access
      val staticData = pendingCallData
      if (staticData != null) {
        android.util.Log.d("CallNotificationData", "Returning data from static cache")
        promise.resolve(createResultMap(staticData))
        pendingCallData = null
        // Also clear SharedPreferences
        clearStoredData()
        return
      }

      // Fall back to SharedPreferences
      val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      // Remove credentials written by older versions before exposing pending
      // call data. Current call actions reacquire credentials through the
      // authenticated API instead of carrying them through intents/storage.
      val legacyCleanupCommitted = prefs.edit()
        .remove(LEGACY_TOKEN_KEY)
        .remove(LEGACY_SERVER_URL_KEY)
        .commit()
      if (!legacyCleanupCommitted) {
        android.util.Log.w("CallNotificationData", "Unable to retire legacy call credentials")
      }
      val callId = prefs.getString(KEY_CALL_ID, null)

      if (callId == null) {
        android.util.Log.d("CallNotificationData", "No stored call data found")
        promise.resolve(null)
        return
      }

      // Check if data is stale (older than 60 seconds)
      val timestamp = prefs.getLong(KEY_TIMESTAMP, 0)
      val age = System.currentTimeMillis() - timestamp
      if (age > 60000) {
        android.util.Log.d("CallNotificationData", "Stored call data is stale ($age ms old), clearing")
        clearStoredData()
        promise.resolve(null)
        return
      }

      val result = mapOf(
        KEY_CALL_ID to callId,
        KEY_CALL_ACTION to prefs.getString(KEY_CALL_ACTION, null),
        KEY_CALLER_NAME to prefs.getString(KEY_CALLER_NAME, null),
        KEY_CALL_TYPE to prefs.getString(KEY_CALL_TYPE, null),
        KEY_CHANNEL_ID to prefs.getString(KEY_CHANNEL_ID, null),
        KEY_IS_INCOMING_CALL to prefs.getBoolean(KEY_IS_INCOMING_CALL, false).toString(),
        KEY_ACTION_URL to prefs.getString(KEY_ACTION_URL, null)
      )


      // Clear after reading
      clearStoredData()

      promise.resolve(createResultMap(result))
    } catch (e: Exception) {
      android.util.Log.e("CallNotificationData", "Error getting call data", e)
      promise.reject("ERROR", e.message)
    }
  }

  /**
   * Clear stored call data without reading it.
   */
  @ReactMethod
  fun clearCallData(promise: Promise) {
    try {
      pendingCallData = null
      clearStoredData()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  /**
   * Used by the JS call-screen back button. If the call was answered from the
   * lock screen and the device is still locked, background the task so Android
   * returns to keyguard instead of navigating inside Lotus.
   */
  @ReactMethod
  fun returnToKeyguardIfLockedAnsweredCall(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.resolve(false)
      return
    }

    activity.runOnUiThread {
      try {
        val extras = activity.intent?.extras
        val callAction = extras?.getString("callAction")
        @Suppress("DEPRECATION")
        val autoJoinCallValue = extras?.get("autoJoinCall")
        val autoJoinCallFromString =
          (autoJoinCallValue as? String)?.equals("true", ignoreCase = true) == true
        val autoJoinCall = extras?.getBoolean("autoJoinCall", false) == true ||
          autoJoinCallFromString
        val isAnsweredCall =
          extras?.getBoolean("isIncomingCall", false) == true &&
            (callAction == "answer" || autoJoinCall)
        val wasAnsweredFromLockedScreen =
          isAnsweredCall && extras?.getBoolean("answeredFromLockedScreen", false) == true
        val isLocked =
          (activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
            ?.isKeyguardLocked == true

        if (!wasAnsweredFromLockedScreen || !isLocked) {
          promise.resolve(false)
          return@runOnUiThread
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(false)
          activity.setTurnScreenOn(false)
        } else {
          @Suppress("DEPRECATION")
          activity.window.clearFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
              WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          )
        }
        activity.window.clearFlags(
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        )
        activity.moveTaskToBack(true)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("ERROR", e.message)
      }
    }
  }

  /**
   * Records users' already-cached avatar files (userId -> local path) for later use by the
   * lock-screen incoming-call UI. JS sends them a batch at a time; only the mappings that
   * changed are written, in a single edit, so re-seeing known avatars costs no disk write.
   * Fire-and-forget: JS never awaits this, and a failure here must never surface — it only
   * means those callers fall back to initials, exactly like users we've never seen before.
   */
  @ReactMethod
  fun cacheCallerAvatars(filePathsByUserId: ReadableMap) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences(AVATAR_PREFS_NAME, Context.MODE_PRIVATE)
      val editor = prefs.edit()
      var changed = false
      val userIds = filePathsByUserId.keySetIterator()
      while (userIds.hasNextKey()) {
        val userId = userIds.nextKey()
        val filePath = filePathsByUserId.getString(userId)
        if (userId.isBlank() || filePath.isNullOrBlank()) continue
        if (prefs.getString(userId, null) == filePath) continue
        editor.putString(userId, filePath)
        changed = true
      }
      if (changed) editor.apply()
    } catch (e: Exception) {
      android.util.Log.w("CallNotificationData", "Unable to cache caller avatars: \${e.message}")
    }
  }

  private fun clearStoredData() {
    val prefs = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.edit().clear().commit()) {
      android.util.Log.w("CallNotificationData", "Unable to clear stored call data")
    }
    android.util.Log.d("CallNotificationData", "Cleared stored call data")
  }

  private fun createResultMap(data: Map<String, String?>): WritableMap {
    return Arguments.createMap().apply {
      putString(KEY_CALL_ID, data[KEY_CALL_ID])
      putString(KEY_CALL_ACTION, data[KEY_CALL_ACTION])
      putString(KEY_CALLER_NAME, data[KEY_CALLER_NAME])
      putString(KEY_CALL_TYPE, data[KEY_CALL_TYPE])
      putString(KEY_CHANNEL_ID, data[KEY_CHANNEL_ID])
      putBoolean(KEY_IS_INCOMING_CALL, data[KEY_IS_INCOMING_CALL]?.toBoolean() ?: false)
      putString(KEY_ACTION_URL, data[KEY_ACTION_URL])
    }
  }
}
`;
}

const exportedPlugin = createRunOncePlugin(
  withNativeIncomingCallAndroid,
  PLUGIN_NAME,
  PLUGIN_VERSION,
);
exportedPlugin.sanitizeLegacyLaunchIntentLogs = sanitizeLegacyLaunchIntentLogs;

module.exports = exportedPlugin;
