import { Platform } from 'react-native';

import { callKitService as androidCallKitService } from './CallKitService.android';
import { callKitService as iosCallKitService } from './CallKitService.ios';

export const callKitService = Platform.OS === 'ios' ? iosCallKitService : androidCallKitService;
