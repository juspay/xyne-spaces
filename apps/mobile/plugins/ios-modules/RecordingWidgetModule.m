#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(RecordingWidgetModule, RCTEventEmitter)
RCT_EXTERN_METHOD(publishState:(BOOL)isRecording
                  startTimeMs:(double)startTimeMs
                  externalId:(NSString *)externalId
                  hasError:(BOOL)hasError
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
