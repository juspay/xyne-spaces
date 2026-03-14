/*
 * mic-monitor: A lightweight CoreAudio + NSWorkspace listener that emits
 * JSON lines to stdout when:
 *   - The system microphone starts/stops being used
 *   - The default input device changes
 *   - The frontmost application changes
 *
 * Output format (one JSON object per line):
 *   {"event":"mic_state","active":true,"deviceId":42}
 *   {"event":"mic_state","active":false,"deviceId":42}
 *   {"event":"device_changed","active":true,"deviceId":57}
 *   {"event":"app_activated","app":"Google Chrome","bundleId":"com.google.Chrome"}
 *   {"event":"error","message":"..."}
 *
 * All events are delivered via GCD (dispatch_main). No polling.
 * Requires no special permissions.
 */

#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <objc/objc.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── Globals ──────────────────────────────────────────────────────── */

static AudioDeviceID g_current_input_device = 0;
static dispatch_queue_t g_listener_queue = NULL;

static AudioObjectPropertyListenerBlock g_mic_listener_block = NULL;
static AudioObjectPropertyListenerBlock g_device_listener_block = NULL;

/* ── JSON Output ──────────────────────────────────────────────────── */

static void emit_mic_state(int active, AudioDeviceID device_id) {
    printf("{\"event\":\"mic_state\",\"active\":%s,\"deviceId\":%u}\n",
           active ? "true" : "false", (unsigned)device_id);
    fflush(stdout);
}

static void emit_device_changed(AudioDeviceID device_id, int active) {
    printf("{\"event\":\"device_changed\",\"active\":%s,\"deviceId\":%u}\n",
           active ? "true" : "false", (unsigned)device_id);
    fflush(stdout);
}

/* Write a JSON-escaped string to stdout (escapes backslash and double-quote) */
static void write_json_string(const char *s) {
    if (!s) return;
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') putchar('\\');
        putchar(*s);
    }
}

static void emit_app_activated(const char *app_name, const char *bundle_id) {
    printf("{\"event\":\"app_activated\",\"app\":\"");
    write_json_string(app_name);
    printf("\",\"bundleId\":\"");
    write_json_string(bundle_id);
    printf("\"}\n");
    fflush(stdout);
}

static void emit_error(const char *message) {
    printf("{\"event\":\"error\",\"message\":\"%s\"}\n", message);
    fflush(stdout);
}

/* ── CoreAudio Helpers ────────────────────────────────────────────── */

static AudioDeviceID get_default_input_device(void) {
    AudioDeviceID device_id = 0;
    UInt32 size = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress address = {
        .mSelector = kAudioHardwarePropertyDefaultInputDevice,
        .mScope    = kAudioObjectPropertyScopeGlobal,
        .mElement  = kAudioObjectPropertyElementMain,
    };

    OSStatus status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject, &address, 0, NULL, &size, &device_id);

    if (status != noErr || device_id == kAudioObjectUnknown) {
        return 0;
    }
    return device_id;
}

static int is_mic_running(AudioDeviceID device_id) {
    UInt32 is_running = 0;
    UInt32 size = sizeof(UInt32);
    AudioObjectPropertyAddress address = {
        .mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere,
        .mScope    = kAudioObjectPropertyScopeGlobal,
        .mElement  = kAudioObjectPropertyElementMain,
    };

    OSStatus status = AudioObjectGetPropertyData(
        device_id, &address, 0, NULL, &size, &is_running);

    if (status != noErr) return 0;
    return is_running != 0;
}

/* ── CoreAudio Listener Management ───────────────────────────────── */

static void remove_mic_listener(void) {
    if (g_current_input_device != 0 && g_mic_listener_block != NULL) {
        AudioObjectPropertyAddress addr = {
            .mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere,
            .mScope    = kAudioObjectPropertyScopeGlobal,
            .mElement  = kAudioObjectPropertyElementMain,
        };
        AudioObjectRemovePropertyListenerBlock(
            g_current_input_device, &addr, g_listener_queue, g_mic_listener_block);
    }
}

static void add_mic_listener(AudioDeviceID device_id) {
    AudioObjectPropertyAddress mic_addr = {
        .mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere,
        .mScope    = kAudioObjectPropertyScopeGlobal,
        .mElement  = kAudioObjectPropertyElementMain,
    };

    g_mic_listener_block = ^(UInt32 num_addresses,
                             const AudioObjectPropertyAddress *addresses) {
        (void)num_addresses;
        (void)addresses;
        int active = is_mic_running(g_current_input_device);
        emit_mic_state(active, g_current_input_device);
    };

    OSStatus status = AudioObjectAddPropertyListenerBlock(
        device_id, &mic_addr, g_listener_queue, g_mic_listener_block);

    if (status != noErr) {
        emit_error("Failed to add mic listener on device");
    }
}

/* ── NSWorkspace App Activation Observer ─────────────────────────── */

/*
 * We use the Objective-C runtime directly (no .m file needed) to observe
 * NSWorkspace.didActivateApplicationNotification. This fires whenever
 * the frontmost application changes — fully event-driven, no polling.
 */

/* Observer callback method: called by NSNotificationCenter */
static void app_activated_callback(id self, SEL _cmd, id notification) {
    (void)self;
    (void)_cmd;

    /* notification.userInfo[@"NSWorkspaceApplicationKey"] */
    id userInfo = ((id(*)(id, SEL))objc_msgSend)(notification, sel_registerName("userInfo"));
    if (!userInfo) return;

    id key = ((id(*)(id, SEL, const char*))objc_msgSend)(
        (id)objc_getClass("NSString"),
        sel_registerName("stringWithUTF8String:"),
        "NSWorkspaceApplicationKey");
    id app = ((id(*)(id, SEL, id))objc_msgSend)(userInfo, sel_registerName("objectForKey:"), key);
    if (!app) return;

    /* Get localizedName */
    id nameObj = ((id(*)(id, SEL))objc_msgSend)(app, sel_registerName("localizedName"));
    const char *name = nameObj
        ? ((const char *(*)(id, SEL))objc_msgSend)(nameObj, sel_registerName("UTF8String"))
        : "";

    /* Get bundleIdentifier */
    id bundleObj = ((id(*)(id, SEL))objc_msgSend)(app, sel_registerName("bundleIdentifier"));
    const char *bundle = bundleObj
        ? ((const char *(*)(id, SEL))objc_msgSend)(bundleObj, sel_registerName("UTF8String"))
        : "";

    emit_app_activated(name, bundle);
}

static void setup_workspace_observer(void) {
    /* Create a dynamic ObjC class with a callback method */
    Class observerClass = objc_allocateClassPair(
        (Class)objc_getClass("NSObject"), "MicMonitorObserver", 0);
    if (!observerClass) {
        emit_error("Failed to create observer class");
        return;
    }

    class_addMethod(observerClass,
                    sel_registerName("appActivated:"),
                    (IMP)app_activated_callback,
                    "v@:@");
    objc_registerClassPair(observerClass);

    /* Instantiate the observer */
    id observer = ((id(*)(id, SEL))objc_msgSend)(
        ((id(*)(id, SEL))objc_msgSend)((id)observerClass, sel_registerName("alloc")),
        sel_registerName("init"));

    /* Get NSWorkspace.sharedWorkspace.notificationCenter */
    id workspace = ((id(*)(id, SEL))objc_msgSend)(
        (id)objc_getClass("NSWorkspace"), sel_registerName("sharedWorkspace"));
    id center = ((id(*)(id, SEL))objc_msgSend)(
        workspace, sel_registerName("notificationCenter"));

    /* Get the notification name: NSWorkspaceDidActivateApplicationNotification */
    id notifName = ((id(*)(id, SEL, const char*))objc_msgSend)(
        (id)objc_getClass("NSString"),
        sel_registerName("stringWithUTF8String:"),
        "NSWorkspaceDidActivateApplicationNotification");

    /* Register: [center addObserver:observer selector:@selector(appActivated:)
                             name:notifName object:nil] */
    ((void(*)(id, SEL, id, SEL, id, id))objc_msgSend)(
        center,
        sel_registerName("addObserver:selector:name:object:"),
        observer,
        sel_registerName("appActivated:"),
        notifName,
        nil);
}

/* ── Signal Handling ──────────────────────────────────────────────── */

static void cleanup_and_exit(void) {
    remove_mic_listener();

    if (g_device_listener_block != NULL) {
        AudioObjectPropertyAddress dev_addr = {
            .mSelector = kAudioHardwarePropertyDefaultInputDevice,
            .mScope    = kAudioObjectPropertyScopeGlobal,
            .mElement  = kAudioObjectPropertyElementMain,
        };
        AudioObjectRemovePropertyListenerBlock(
            kAudioObjectSystemObject, &dev_addr, g_listener_queue, g_device_listener_block);
    }

    _exit(0);
}

static void signal_handler(int sig) {
    (void)sig;
    cleanup_and_exit();
}

/* ── Main ─────────────────────────────────────────────────────────── */

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);

    signal(SIGTERM, signal_handler);
    signal(SIGINT, signal_handler);

    g_listener_queue = dispatch_queue_create(
        "com.xyne.mic-monitor.listener", DISPATCH_QUEUE_SERIAL);

    /* --- CoreAudio: mic state monitoring --- */

    AudioDeviceID device = get_default_input_device();
    if (device == 0) {
        emit_error("No default input device found");
        return 1;
    }

    g_current_input_device = device;
    add_mic_listener(device);

    AudioObjectPropertyAddress dev_addr = {
        .mSelector = kAudioHardwarePropertyDefaultInputDevice,
        .mScope    = kAudioObjectPropertyScopeGlobal,
        .mElement  = kAudioObjectPropertyElementMain,
    };

    g_device_listener_block = ^(UInt32 num_addresses,
                                const AudioObjectPropertyAddress *addresses) {
        (void)num_addresses;
        (void)addresses;

        remove_mic_listener();

        AudioDeviceID new_device = get_default_input_device();
        if (new_device == 0) {
            emit_error("No default input device found after device change");
            g_current_input_device = 0;
            return;
        }

        g_current_input_device = new_device;
        add_mic_listener(new_device);

        int active = is_mic_running(new_device);
        emit_device_changed(new_device, active);
    };

    OSStatus dev_status = AudioObjectAddPropertyListenerBlock(
        kAudioObjectSystemObject, &dev_addr, g_listener_queue, g_device_listener_block);

    if (dev_status != noErr) {
        emit_error("Failed to add default device listener");
        return 1;
    }

    /* --- NSWorkspace: frontmost app monitoring --- */

    /* NSApplication must exist for NSWorkspace notifications to be delivered */
    id nsApp = ((id(*)(id, SEL))objc_msgSend)(
        (id)objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
    /* Activate as accessory (no dock icon, no menu bar) */
    ((void(*)(id, SEL, long))objc_msgSend)(
        nsApp, sel_registerName("setActivationPolicy:"), 2 /* NSApplicationActivationPolicyProhibited */);

    setup_workspace_observer();

    /* --- Emit initial state --- */

    int active = is_mic_running(device);
    emit_mic_state(active, device);

    /*
     * Use CFRunLoopRun() instead of dispatch_main().
     * NSWorkspace notifications are delivered on the main run loop.
     * CoreAudio listeners are dispatched on g_listener_queue (GCD),
     * which runs independently on its own thread.
     */
    CFRunLoopRun();

    return 0;
}
