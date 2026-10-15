/**
 * Whether the computer runs on battery, as the desktop app says. Hidden pages are
 * frozen sooner then, as Chrome's Energy Saver does. A desktop app that can't say
 * leaves it as plugged in.
 */

let onBattery = false;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  const api = window.electronAPI;
  if (!api?.getPowerState || !api.onPowerChange) return;
  void api
    .getPowerState()
    .then(state => {
      onBattery = state.onBattery;
    })
    .catch(() => undefined);
  api.onPowerChange(state => {
    onBattery = state.onBattery;
  });
}

export function isOnBattery(): boolean {
  listen();
  return onBattery;
}
