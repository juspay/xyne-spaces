#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LotusShareTargetModule, NSObject)
RCT_EXTERN_METHOD(getInitialShare:(NSString *)shareId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearShare:(NSString *)shareId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(clearAllPendingShares:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
