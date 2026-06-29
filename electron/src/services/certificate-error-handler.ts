import log from 'electron-log/main';
import { config } from '../app/config';
import path from 'path';
import { getMainWindow } from '../window/manager';
import { keychain } from '../keychain';
/**
 * SSL/TLS error codes that indicate certificate issues requiring re-enrollment
 */
const CERTIFICATE_ERROR_CODES = [
  // Network error codes
  'ERR_SSL_CLIENT_AUTH_SIGNATURE_FAILED',
  'ERR_BAD_SSL_CLIENT_AUTH_CERT',
];

/**
 * Check if an error string indicates a certificate problem
 */
export function isCertificateError(errorDescription: string): boolean {
  if (!errorDescription) return false;
  
  const upperError = errorDescription.toUpperCase();
  
  return CERTIFICATE_ERROR_CODES.some(code => {
    const upperCode = code.toUpperCase();
    return upperError.includes(upperCode);
  });
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
    // Clear the invalid certificate from keychain
    log.info('[CertificateErrorHandler] Clearing invalid certificate from keychain');
    await keychain.deleteIdentity(config.MTLS_IDENTITY_NAME);
    log.info('[CertificateErrorHandler] Certificate cleared successfully');
    
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
