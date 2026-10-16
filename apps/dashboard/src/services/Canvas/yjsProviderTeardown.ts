import type { YSweetProvider } from '@y-sweet/client';

/**
 * @y-sweet/client 0.9.1's `websocketClose`/`websocketError` handlers call
 * `this.connect()` unconditionally on every socket close — including the
 * close that `disconnect()`/`destroy()` themselves trigger — with no check
 * for destroyed/offline state. `websocket` is a private field, so there's
 * no supported way to detach its `onclose`/`onerror` from outside the
 * class either. The only way to actually stop the provider from
 * reconnecting is to neutralize `connect()` on the instance itself before
 * tearing it down, so the library's own close handler becomes a no-op.
 */
export function stopYjsProviderPermanently(provider: YSweetProvider): void {
  provider.connect = async () => {};
  provider.disconnect();
  provider.destroy();
}
