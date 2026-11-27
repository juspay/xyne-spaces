//
//  TransitKeyModule.m
//  Lotus
//
//  React Native bridge for TransitKeyModule (LotusTransitKey)
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LotusTransitKey, NSObject)

RCT_EXTERN_METHOD(getPublicKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deriveSharedSecret:(NSString *)serverPoint
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
