#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AuthContextModule, NSObject)

RCT_EXTERN_METHOD(getAuthContextStorageVersion:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setAuthContext:(NSString *)authToken
                  apiBaseUrl:(NSString *)apiBaseUrl
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearAuthContext:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
