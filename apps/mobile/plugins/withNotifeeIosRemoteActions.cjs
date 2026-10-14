const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const TARGET_RELATIVE =
  'node_modules/react-native-notify-kit/ios/NotifeeCore/NotifeeCore+UNUserNotificationCenter.m';

const OLD_BLOCK = `    // Flag ON (default): existing behavior
    if (_originalDelegate != nil && originalUNCDelegateRespondsTo.didReceiveNotificationResponse) {
      NotifeeCoreVoidCompletionHandler oneShotCompletionHandler =
          NotifeeCoreOneShotVoidCompletionHandler(completionHandler);
      [_originalDelegate userNotificationCenter:center
                 didReceiveNotificationResponse:response
                          withCompletionHandler:oneShotCompletionHandler];
      return;
    } else {
      notifeeNotification =
          [NotifeeCoreUtil parseUNNotificationRequest:response.notification.request];
    }`;

const NEW_BLOCK = `    // Flag ON (default): forward default body taps to Firebase for onNotificationOpenedApp,
    // but parse quick actions locally so Notifee ACTION_PRESS events reach JS handlers.
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier] &&
        _originalDelegate != nil &&
        originalUNCDelegateRespondsTo.didReceiveNotificationResponse) {
      NotifeeCoreVoidCompletionHandler oneShotCompletionHandler =
          NotifeeCoreOneShotVoidCompletionHandler(completionHandler);
      [_originalDelegate userNotificationCenter:center
                 didReceiveNotificationResponse:response
                          withCompletionHandler:oneShotCompletionHandler];
      return;
    }

    notifeeNotification =
        [NotifeeCoreUtil parseUNNotificationRequest:response.notification.request];`;

const PATCHED_MARKER =
  'forward default body taps to Firebase for onNotificationOpenedApp';

function patchNotifeeRemoteActions(projectRoot) {
  const targetPath = path.join(projectRoot, TARGET_RELATIVE);
  const contents = readFileIfExists(targetPath);
  if (contents === null) {
    console.warn('[withNotifeeIosRemoteActions] target not found, skipping:', targetPath);
    return;
  }
  if (contents.includes(PATCHED_MARKER)) {
    return;
  }

  if (!contents.includes(OLD_BLOCK)) {
    console.warn(
      '[withNotifeeIosRemoteActions] expected Notifee delegate block not found; skipping patch',
    );
    return;
  }

  fs.writeFileSync(targetPath, contents.replace(OLD_BLOCK, NEW_BLOCK), 'utf8');
  console.log('[withNotifeeIosRemoteActions] patched iOS remote notification quick actions');
}

/**
 * Notifee forwards all remote notification responses to Firebase when it is the
 * original UNUserNotificationCenter delegate. That breaks iOS quick actions
 * (Reply / Mark as read) because ACTION_PRESS never reaches JS onBackgroundEvent.
 *
 * Keep Firebase handling for default body taps only; parse action presses via Notifee.
 */
function withNotifeeIosRemoteActions(config) {
  // Required lazily: the postinstall hook loads this file without @expo/config-plugins on its path.
  const { withDangerousMod } = require('@expo/config-plugins');
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      patchNotifeeRemoteActions(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
}

module.exports = withNotifeeIosRemoteActions;
module.exports.patchNotifeeRemoteActions = patchNotifeeRemoteActions;
