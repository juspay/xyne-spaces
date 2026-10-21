//
//  BroadcastHandler.m
//  BroadcastExtension
//
//  Objective-C implementation that allows passing nil to
//  finishBroadcastWithError. Swift does not allow this since Error is
//  non-optional, but Objective-C does.
//

#import "BroadcastHandler.h"

@implementation BroadcastHandler

+ (void)finishBroadcastGracefully:(RPBroadcastSampleHandler *)handler {
  // Passing nil stops the broadcast without showing an error banner to the user.
  // This is a workaround for Swift's strict non-optional Error requirement.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnonnull"
  [handler finishBroadcastWithError:nil];
#pragma clang diagnostic pop
}

@end
