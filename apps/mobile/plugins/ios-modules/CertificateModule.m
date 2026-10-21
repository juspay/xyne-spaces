//
//  CertificateModule.m
//  Lotus
//
//  React Native bridge for CertificateModule
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(CertificateModule, NSObject)

RCT_EXTERN_METHOD(isEnrolled:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(hasPrivateKey:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generateCSR:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(storeCertificate:(NSString *)certificatePem
                  caChainPem:(NSString * _Nullable)caChainPem
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getCertificate:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearCertificates:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(performMtlsRequest:(NSString *)url
                  requestId:(NSString * _Nullable)requestId
                  method:(NSString * _Nullable)method
                  headers:(NSDictionary * _Nullable)headers
                  body:(id _Nullable)body
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelMtlsRequest:(NSString *)requestId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(invalidateMtlsSession:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(performMtlsMultipartUpload:(NSString *)url
                  fields:(NSDictionary * _Nullable)fields
                  files:(NSArray * _Nullable)files
                  headers:(NSDictionary * _Nullable)headers
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(downloadMtlsFile:(NSString *)url
                  destinationPath:(NSString *)destinationPath
                  headers:(NSDictionary * _Nullable)headers
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end