import { app } from 'electron';
import { X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../app/config';

/**
 * The CA that issues this build's device client certificates, bundled under certs/.
 * The device identity is the keychain certificate, with its private key, that this CA
 * issued; its subject belongs to the enrollment server and is not used for lookup.
 */
export function deviceCaPath(): string {
    const name = config.USER_DATA_SUFFIX === '-sandbox' ? 'ca.sbx.cert' : 'ca.cert';
    return path.join(app.getAppPath(), 'certs', name);
}

let deviceCaName: string | null = null;

export function deviceCaCommonName(): string {
    if (deviceCaName === null) {
        const pem = fs.readFileSync(deviceCaPath(), 'utf8');
        deviceCaName = commonNameOf(new X509Certificate(pem).subject);
    }
    return deviceCaName;
}

// X509Certificate.subject and .issuer are newline-separated "KEY=value" lines.
export function commonNameOf(distinguishedName: string): string {
    const line = distinguishedName.split('\n').find((part) => part.startsWith('CN='));
    return line ? line.slice('CN='.length) : '';
}

export function isIssuedByDeviceCa(certificatePem: string): boolean {
    try {
        return commonNameOf(new X509Certificate(certificatePem).issuer) === deviceCaCommonName();
    } catch {
        return false;
    }
}
