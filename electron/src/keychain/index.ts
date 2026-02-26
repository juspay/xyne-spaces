import { IKeychain } from './IKeychain';
import { macKeychainService } from './macKeychainService';
import { winKeychainService } from './winKeychainService';

const ServiceClass = process.platform === 'win32'
    ? winKeychainService
    : macKeychainService;

export const keychain: IKeychain = ServiceClass;