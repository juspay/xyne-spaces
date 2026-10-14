#import <React/RCTBridgeModule.h>
#include "CrashReporter.h"
#include <signal.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <time.h>
#include <sys/types.h>

#pragma mark - C Signal Handler State

#include <limits.h>

static char g_crashFilePath[PATH_MAX] = {0};
static struct sigaction g_prevActions[6];
static volatile int g_handling = 0;
static const int g_signals[6] = {SIGABRT, SIGILL, SIGSEGV, SIGBUS, SIGFPE, SIGTRAP};

#pragma mark - Helpers

static int signalIdx(int sig) {
  for (int i = 0; i < 6; i++) {
    if (g_signals[i] == sig) return i;
  }
  return -1;
}

static const char *signalName(int sig) {
  switch (sig) {
    case SIGABRT: return "SIGABRT";
    case SIGILL:  return "SIGILL";
    case SIGSEGV: return "SIGSEGV";
    case SIGBUS:  return "SIGBUS";
    case SIGFPE:  return "SIGFPE";
    case SIGTRAP: return "SIGTRAP";
    default:      return "UNKNOWN";
  }
}

/**
 * POSIX signal handler using ONLY async-signal-safe operations.
 *
 * Safe: open, write, close, ftruncate, lseek, _exit, snprintf, time,
 *       __sync_fetch_and_add, sigaction, raise.
 *
 * Opens the crash file fresh on each crash to avoid a stale fd
 * colliding with the NSException handler's atomic file replace.
 */
static void crashreporter_signal_handler(int sig, siginfo_t *info, void *context) {
  (void)context;

  // Recursive-crash guard
  if (__sync_fetch_and_add(&g_handling, 1) != 0) {
    _exit(EXIT_FAILURE);
  }

  if (g_crashFilePath[0] != '\0') {
    int fd = open(g_crashFilePath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
      char buf[4096];
      const char *name = signalName(sig);
      void *addr = (info != NULL) ? info->si_addr : NULL;
      time_t now = time(NULL);

      int len = snprintf(
        buf, sizeof(buf),
        "{"
        "\"type\":\"native_ios\","
        "\"message\":\"Signal %s received\","
        "\"name\":\"%s\","
        "\"faultAddress\":\"%p\","
        "\"timestamp\":\"%ld\""
        "}",
        name, name, addr, (long)now
      );

      if (len > 0) {
        size_t writeLen = (size_t)(len < (int)sizeof(buf) ? len : (int)sizeof(buf) - 1);
        ssize_t written = write(fd, buf, writeLen);
        (void)written;
      }

      close(fd);
    }
  }

  // Restore previous handler and re-raise
  int idx = signalIdx(sig);
  if (idx >= 0) {
    sigaction(sig, &g_prevActions[idx], NULL);
  }
  raise(sig);
}

#pragma mark - Public C API

void crashreporter_install_handlers(const char *crash_file_path) {
  if (crash_file_path != NULL) {
    strncpy(g_crashFilePath, crash_file_path, PATH_MAX - 1);
    g_crashFilePath[PATH_MAX - 1] = '\0';
  }

  // Alternate signal stack for stack-overflow protection
  stack_t ss;
  ss.ss_size = SIGSTKSZ;
  ss.ss_sp = malloc(ss.ss_size);
  ss.ss_flags = 0;
  sigaltstack(&ss, NULL);

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_sigaction = crashreporter_signal_handler;
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&action.sa_mask);

  for (int i = 0; i < 6; i++) {
    sigaction(g_signals[i], &action, &g_prevActions[i]);
  }
}

#pragma mark - RN Bridge

@interface RCT_EXTERN_MODULE(LotusCrashReporter, NSObject)

RCT_EXTERN_METHOD(
  getPendingCrash:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  clearPendingCrash:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  getPendingCrashes:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  clearAllPendingCrashes:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(simulateNativeCrash)

RCT_EXTERN_METHOD(
  getNativeAppInfo:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

@end