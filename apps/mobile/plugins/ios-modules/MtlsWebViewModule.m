//
//  MtlsWebViewModule.m
//  Lotus
//
//  React Native bridge for MtlsWebViewModule
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MtlsWebViewModule, NSObject)

RCT_EXTERN_METHOD(enableMtls:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(disableMtls:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isMtlsEnabled:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end