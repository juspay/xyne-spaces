#import "NotificationCacheWriter.h"
#import <MMKVCore/MMKV.h>

static NSString *NotificationDiagHashKey(NSString *key) {
  uint32_t hash = 5381;
  for (NSUInteger index = 0; index < key.length; index++) {
    unichar character = [key characterAtIndex:index];
    hash = ((hash << 5) + hash) + character;
  }
  return [NSString stringWithFormat:@"%x", hash];
}

/** Overwrite one last-op marker in the extension sandbox (not App Group). */
static void NotificationRememberLastOp(NSString *op, NSString *key) {
  @try {
    NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:@"mmkv_nse_last_op.json"];
    NSString *json = [NSString stringWithFormat:
                      @"{\"ts\":%lld,\"op\":\"%@\",\"caller\":\"nse\",\"keyHash\":\"%@\"}",
                      (long long)(NSDate.date.timeIntervalSince1970 * 1000),
                      op,
                      NotificationDiagHashKey(key ?: @"")];
    [json writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  } @catch (NSException *exception) {
    // RCA must never block cache I/O.
  }
}

static BOOL NotificationCacheEnsureMMKVInitialized(NSString *appGroupId) {
  static dispatch_once_t onceToken;
  static BOOL initialized = NO;

  dispatch_once(&onceToken, ^{
    NSURL *containerURL = [[NSFileManager defaultManager]
      containerURLForSecurityApplicationGroupIdentifier:appGroupId];

    if (containerURL == nil) {
      NSLog(@"[NotificationCacheWriter] Failed to resolve app group container: %@", appGroupId);
      return;
    }

    std::string rootPath([containerURL.path UTF8String]);
    mmkv::MMKV::initializeMMKV(rootPath, mmkv::MMKVLogInfo);
    initialized = YES;
  });

  return initialized;
}

static mmkv::MMKV *NotificationCacheStorage(NSString *appGroupId, NSString *mmapId) {
  if (!NotificationCacheEnsureMMKVInitialized(appGroupId)) {
    return nullptr;
  }

  std::string mmapKey([mmapId UTF8String]);
  return mmkv::MMKV::mmkvWithID(mmapKey, mmkv::MMKV_MULTI_PROCESS);
}

NSString * _Nullable NotificationCacheGetString(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key
) {
  NotificationRememberLastOp(@"get", key);

  mmkv::MMKV *storage = NotificationCacheStorage(appGroupId, mmapId);
  if (storage == nullptr) {
    return nil;
  }

  std::string result;
  std::string storageKey([key UTF8String]);
  if (!storage->getString(storageKey, result)) {
    return nil;
  }

  return [NSString stringWithUTF8String:result.c_str()];
}

BOOL NotificationCacheSetString(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key,
  NSString *value
) {
  NotificationRememberLastOp(@"set", key);

  mmkv::MMKV *storage = NotificationCacheStorage(appGroupId, mmapId);
  if (storage == nullptr) {
    return NO;
  }

  std::string storageKey([key UTF8String]);
  std::string storageValue([value UTF8String]);
  BOOL didSet = storage->set(storageValue, storageKey);
  storage->sync(mmkv::MMKV_SYNC);
  return didSet;
}

NSArray<NSString *> *NotificationCacheAllKeys(NSString *appGroupId, NSString *mmapId) {
  NotificationRememberLastOp(@"getAllKeys", @"");

  mmkv::MMKV *storage = NotificationCacheStorage(appGroupId, mmapId);
  if (storage == nullptr) {
    return @[];
  }

  std::vector<std::string> keys = storage->allKeys();
  NSMutableArray<NSString *> *result = [NSMutableArray arrayWithCapacity:keys.size()];

  for (const auto &key : keys) {
    [result addObject:[NSString stringWithUTF8String:key.c_str()]];
  }

  return result;
}

BOOL NotificationCacheDeleteKey(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key
) {
  NotificationRememberLastOp(@"remove", key);

  mmkv::MMKV *storage = NotificationCacheStorage(appGroupId, mmapId);
  if (storage == nullptr) {
    return NO;
  }

  std::string storageKey([key UTF8String]);
  storage->removeValueForKey(storageKey);
  storage->sync(mmkv::MMKV_SYNC);
  return YES;
}
