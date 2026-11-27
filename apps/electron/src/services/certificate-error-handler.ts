import log from 'electron-log/main';
import type { WebContents } from 'electron';
import path from 'path';
import { getMainWindow } from '../window/manager';
import { keychain } from '../keychain';
/**
 * Error code the mTLS gateway returns, with HTTP 403, when the client certificate has been
 * revoked. The TLS handshake still succeeds, so this arrives as a response, not a load error.
 */
export const CLIENT_CERTIFICATE_REVOKED = 'client_certificate_revoked';

/**
 * Whether a response is the gateway's revoked-certificate rejection, which requires re-enrollment
 */
export function isCertificateRevokedResponse(statusCode: number, body: string): boolean {
  return statusCode === 403 && body.includes(CLIENT_CERTIFICATE_REVOKED);
}

/**
 * Reads the loaded page's text, e.g. a JSON error body that Chromium renders as plain text
 */
export async function readPageText(webContents: WebContents): Promise<string> {
  try {
    const text: unknown = await webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

/**
 * Handle certificate error by clearing certificates and redirecting to enrollment
 */
export async function handleCertificateError(
  errorDetails: {
    url?: string;
    errorCode?: string;
    errorDescription?: string;
  }
): Promise<void> {
  log.error('[CertificateErrorHandler] Certificate error detected:', {
    url: errorDetails.url,
    errorCode: errorDetails.errorCode,
    errorDescription: errorDetails.errorDescription,
  });
  try {
    // Clear the invalid certificate from keychain. A failure here (locked keychain, user
    // cancels the keychain auth prompt, ACL denial) must NOT prevent loading the
    // re-enrollment page — that page hosts the only "Re-enroll Device" recovery action,
    // so aborting into the catch below would trap the user in a permanent dead-end loop.
    log.info('[CertificateErrorHandler] Clearing invalid certificate from keychain');
    try {
      await keychain.deleteIdentity();
      log.info('[CertificateErrorHandler] Certificate cleared successfully');
    } catch (deleteError) {
      log.error('[CertificateErrorHandler] Failed to clear certificate; continuing to re-enrollment page anyway:', deleteError);
    }

    const mainWindow = getMainWindow();

    if (mainWindow) {
      // Load the invalid certificate error page
      const errorPage = path.join(__dirname, '..', '..', 'assets', 'invalid-certificate.html');
      log.info('[CertificateErrorHandler] Loading invalid certificate page');
      await mainWindow.loadFile(errorPage);
    } else {
      log.error('[CertificateErrorHandler] Main window is not available to reload the app');
    }

  } catch (error) {
    log.error('[CertificateErrorHandler] Failed to handle certificate error:', error);

    // Show error dialog to user
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Certificate Error',
      'Your device certificate is invalid. Please restart the application to re-enroll.'
    );
  }
}
