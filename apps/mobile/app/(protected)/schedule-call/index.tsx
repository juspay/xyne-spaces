import { useCallback, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import ScheduleCallScreen from '@/src/features/schedule-call/screens/ScheduleCallScreen';

export default function ScheduleCallRoute(): ReactElement {
  const router = useRouter();

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(protected)/(tabs)/calls');
  }, [router]);

  return <ScheduleCallScreen onClose={handleClose} />;
}
