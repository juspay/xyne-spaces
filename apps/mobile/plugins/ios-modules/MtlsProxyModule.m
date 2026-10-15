//
//  MtlsProxyModule.m
//  Lotus
//
//  React Native bridge for MtlsProxy
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MtlsProxy, NSObject)

RCT_EXTERN_METHOD(getProxySecurityVersion:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(start:(nonnull NSNumber *)port
                  apiBaseUrl:(NSString *)apiBaseUrl
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setAuthToken:(NSString * _Nullable)token
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getPort:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getProxiedUrl:(NSString *)backendUrl
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
