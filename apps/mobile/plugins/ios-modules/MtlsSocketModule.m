#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(MtlsSocketModule, RCTEventEmitter)

RCT_EXTERN_METHOD(connect:(NSString *)url
                  protocols:(NSArray<NSString *> * _Nullable)protocols
                  headers:(NSDictionary<NSString *, NSString *> * _Nullable)headers
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(send:(nonnull NSNumber *)socketId
                  data:(NSString *)data
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(close:(nonnull NSNumber *)socketId
                  code:(NSNumber * _Nullable)code
                  reason:(NSString * _Nullable)reason
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
