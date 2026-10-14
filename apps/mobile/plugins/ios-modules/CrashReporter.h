//
//  CrashReporter.h
//  XyneSpaces
//
//  C-level declarations for the native crash reporter signal handler.
//  Imported via the bridging header so Swift can call crashreporter_install_handlers().
//

#ifndef CrashReporter_h
#define CrashReporter_h

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Install POSIX signal handlers that write a minimal crash record to
 * `crash_file_path` when SIGABRT/SIGILL/SIGSEGV/SIGBUS/SIGFPE/SIGTRAP fire.
 *
 * The handlers are async-signal-safe (POSIX) and use an alternate signal
 * stack so stack-overflow crashes do not starve the handler frame.
 *
 * Safe to call multiple times — idempotent.
 */
void crashreporter_install_handlers(const char *crash_file_path);

#ifdef __cplusplus
}
#endif

#endif /* CrashReporter_h */
