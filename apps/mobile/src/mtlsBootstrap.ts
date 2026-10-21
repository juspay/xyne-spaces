import { Platform } from 'react-native';

import { initializeMtlsTransport } from './utils/mtlsTransport';

if (Platform.OS === 'android' || Platform.OS === 'ios') {
  initializeMtlsTransport();
}
