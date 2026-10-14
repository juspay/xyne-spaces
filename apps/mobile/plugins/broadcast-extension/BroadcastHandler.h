//
//  BroadcastHandler.h
//  BroadcastExtension
//
//  Helper to stop broadcast gracefully without showing error to user
//

#import <ReplayKit/ReplayKit.h>

@interface BroadcastHandler : NSObject

/// Finish broadcast without showing error to user (passes nil to
/// finishBroadcastWithError)
+ (void)finishBroadcastGracefully:(RPBroadcastSampleHandler *)handler;

@end