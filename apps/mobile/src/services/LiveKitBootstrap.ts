import { registerGlobals } from '@livekit/react-native';

let globalsEnsured = false;

export function ensureLiveKitGlobals(): void {
  if (!globalsEnsured) {
    registerGlobals();
    globalsEnsured = true;
  }
}
