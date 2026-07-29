import { IKeychain } from './IKeychain';
import { macKeychainService } from './macKeychainService';
import { winKeychainService } from './winKeychainService';
import { linuxKeychainService } from './linuxKeychainService';

const ServiceClass = process.platform === 'win32'
    ? winKeychainService
    : process.platform === 'linux'
    ? linuxKeychainService
    : macKeychainService;

export const keychain: IKeychain = ServiceClass;