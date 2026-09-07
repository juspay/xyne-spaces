// Native Liquid Glass backdrop for the main window (macOS 26+).
//
// Builds as a plain N-API addon — no node-gyp, no node-addon-api, no npm
// dependency — so it follows the same shape as native/mic-monitor: one clang
// invocation per architecture, lipo'd into a universal binary. N-API is
// ABI-stable, so this binary keeps loading across Electron majors without a
// rebuild.
//
// Public AppKit API only. NSGlassEffectView exposes exactly four settable
// properties worth having — contentView, style, cornerRadius, tintColor — and
// `style` (Regular / Clear) is the same choice macOS offers in
// System Settings > Appearance > Liquid Glass. Everything else that third-party
// wrappers reach for (_variant, _scrimState, _subduedState) is private
// underscore API that can disappear in any macOS point release, so none of it
// is used here.

#define NAPI_VERSION 8
#include <node_api.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <map>

// Declared rather than imported so this still compiles and loads on macOS
// older than 26, where the class simply does not exist. Every use is gated on
// NSClassFromString + respondsToSelector, so a missing class is a clean no-op
// rather than a link error.
@protocol XyneGlassEffect <NSObject>
@property(nullable, copy) NSColor *tintColor;
@property CGFloat cornerRadius;
@property NSInteger style;  // NSGlassEffectViewStyleRegular = 0, Clear = 1
@end

static std::map<int, NSView *> g_views;
static int g_nextId = 1;

// The backdrop must never answer a hit test. Measured on Electron 39, adding a
// view at the back of BridgedContentView leaves hitTest: resolving to
// RenderWidgetHostViewCocoa either way — but that is a property of today's view
// ordering, not a guarantee. Returning nil makes the glass structurally
// incapable of intercepting a click, which is what a decorative layer should be
// regardless of how Electron rearranges its hierarchy.
static id GlassHitTest(id self, SEL _cmd, NSPoint point) {
  return nil;
}

static Class PassThroughSubclassOf(Class base, const char *name) {
  if (!base) return nil;
  Class sub = objc_getClass(name);
  if (!sub) {
    sub = objc_allocateClassPair(base, name, 0);
    if (!sub) return base;
    class_addMethod(sub, @selector(hitTest:), (IMP)GlassHitTest, "@@:{CGPoint=dd}");
    objc_registerClassPair(sub);
  }
  return sub;
}

// #RRGGBB or #RRGGBBAA. Deliberately RGBA and not ARGB: it matches CSS, which
// is what every colour in this codebase is already written as.
static NSColor *ColorFromHex(NSString *hex) {
  if (!hex.length) return nil;
  NSString *s = [[hex stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] uppercaseString];
  if ([s hasPrefix:@"#"]) s = [s substringFromIndex:1];
  if (s.length != 6 && s.length != 8) return nil;
  unsigned int v = 0;
  if (![[NSScanner scannerWithString:s] scanHexInt:&v]) return nil;
  CGFloat r, g, b, a;
  if (s.length == 6) {
    r = ((v & 0xFF0000) >> 16) / 255.0; g = ((v & 0x00FF00) >> 8) / 255.0;
    b = (v & 0x0000FF) / 255.0;         a = 1.0;
  } else {
    r = ((v & 0xFF000000) >> 24) / 255.0; g = ((v & 0x00FF0000) >> 16) / 255.0;
    b = ((v & 0x0000FF00) >> 8) / 255.0;  a = (v & 0x000000FF) / 255.0;
  }
  return [NSColor colorWithSRGBRed:r green:g blue:b alpha:a];
}

// NSGlassEffectViewStyle has exactly two cases: Regular (0) and Clear (1).
// AppKit itself coerces anything else back to Regular — measured on macOS 26.5,
// where style 2, 23 and -1 all read back as 0 — but that is undocumented
// behaviour, so pin it here instead of relying on it.
static NSInteger ClampStyle(int32_t style) {
  return style == 1 ? 1 : 0;
}

static void OnMain(dispatch_block_t block) {
  if (NSThread.isMainThread) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

static NSView *ViewForId(int id_) {
  auto it = g_views.find(id_);
  return it == g_views.end() ? nil : it->second;
}

// ---------------------------------------------------------------- JS surface

static napi_value IsSupported(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_get_boolean(env, NSClassFromString(@"NSGlassEffectView") != nil, &out);
  return out;
}

static bool StringArg(napi_env env, napi_value v, NSString **out) {
  napi_valuetype t;
  napi_typeof(env, v, &t);
  if (t != napi_string) return false;
  size_t len = 0;
  napi_get_value_string_utf8(env, v, NULL, 0, &len);
  char *buf = (char *)malloc(len + 1);
  napi_get_value_string_utf8(env, v, buf, len + 1, &len);
  *out = [NSString stringWithUTF8String:buf];
  free(buf);
  return true;
}

// attach(handleBuffer, { style?, cornerRadius?, tintColor? }) -> viewId | -1
static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  void *data = NULL;
  size_t len = 0;
  napi_value out;
  if (napi_get_buffer_info(env, argv[0], &data, &len) != napi_ok || !data || len < sizeof(void *)) {
    napi_create_int32(env, -1, &out);
    return out;
  }

  int32_t style = 0;
  double cornerRadius = 0.0;
  NSString *tint = nil;
  if (argc >= 2) {
    napi_value v;
    if (napi_get_named_property(env, argv[1], "style", &v) == napi_ok) napi_get_value_int32(env, v, &style);
    if (napi_get_named_property(env, argv[1], "cornerRadius", &v) == napi_ok) napi_get_value_double(env, v, &cornerRadius);
    if (napi_get_named_property(env, argv[1], "tintColor", &v) == napi_ok) StringArg(env, v, &tint);
  }

  __block int result = -1;
  NSView *host = *(__unsafe_unretained NSView **)data;
  OnMain(^{
    Class base = NSClassFromString(@"NSGlassEffectView");
    if (!base || !host) return;
    Class cls = PassThroughSubclassOf(base, "XyneGlassEffectView");
    NSView *glass = [[cls alloc] initWithFrame:host.bounds];
    if (!glass) return;
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    id<XyneGlassEffect> g = (id<XyneGlassEffect>)glass;
    if ([glass respondsToSelector:@selector(setStyle:)]) g.style = ClampStyle(style);
    if (cornerRadius > 0 && [glass respondsToSelector:@selector(setCornerRadius:)]) g.cornerRadius = cornerRadius;
    NSColor *c = ColorFromHex(tint);
    if (c && [glass respondsToSelector:@selector(setTintColor:)]) g.tintColor = c;

    // Behind everything. The host view here is BridgedContentView, whose
    // subviews are ViewsCompositorSuperview and WebContentsViewCocoa; going to
    // the back puts the glass under both, which is what makes it a backdrop
    // the transparent web content shows through.
    [host addSubview:glass positioned:NSWindowBelow relativeTo:nil];

    result = g_nextId++;
    g_views[result] = glass;
  });

  napi_create_int32(env, result, &out);
  return out;
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  int32_t id_ = 0;
  napi_get_value_int32(env, argv[0], &id_);
  OnMain(^{
    NSView *v = ViewForId(id_);
    if (v) [v removeFromSuperview];
    g_views.erase(id_);
  });
  napi_value u;
  napi_get_undefined(env, &u);
  return u;
}

NAPI_MODULE_INIT() {
  struct { const char *name; napi_callback fn; } entries[] = {
    {"isSupported", IsSupported}, {"attach", Attach}, {"detach", Detach},
  };
  for (auto &e : entries) {
    napi_value fn;
    napi_create_function(env, e.name, NAPI_AUTO_LENGTH, e.fn, NULL, &fn);
    napi_set_named_property(env, exports, e.name, fn);
  }
  return exports;
}
