import CookieManager from '@react-native-cookies/cookies';
import { ZERO_SERVER_URL } from '../../config';

/**
 * The sync proxy reads the client's transit key from the `xk` cookie on the Zero websocket
 * (percent-encoded, as the backend sets it). Set here so it is there over http in development too.
 * Native store, not WebKit's: the iOS websocket reads cookies from NSHTTPCookieStorage.
 */
export async function setSyncProxyTransitKey(publicKey: string): Promise<void> {
  const url = new URL(ZERO_SERVER_URL);
  await CookieManager.set(url.origin, {
    name: 'xk',
    value: encodeURIComponent(publicKey),
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
  });
}
