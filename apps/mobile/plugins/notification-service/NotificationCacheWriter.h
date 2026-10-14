#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString * _Nullable NotificationCacheGetString(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key
);

FOUNDATION_EXPORT BOOL NotificationCacheSetString(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key,
  NSString *value
);

FOUNDATION_EXPORT NSArray<NSString *> *NotificationCacheAllKeys(
  NSString *appGroupId,
  NSString *mmapId
);

FOUNDATION_EXPORT BOOL NotificationCacheDeleteKey(
  NSString *appGroupId,
  NSString *mmapId,
  NSString *key
);

NS_ASSUME_NONNULL_END
