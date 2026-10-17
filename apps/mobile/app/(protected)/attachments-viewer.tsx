import { useCallback, useEffect, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { AttachmentsViewer } from '@/src/components/attachments-viewer/attachments-viewer';
import { attachmentsActor } from '@/src/machines/attachmentsMachine';

const AttachmentsViewerScreen = (): ReactElement => {
  const router = useRouter();

  const handleClose = useCallback((): void => {
    router.back();
  }, [router]);

  useEffect(() => {
    return () => {
      attachmentsActor.send({ type: 'CLOSE' });
    };
  }, []);

  return <AttachmentsViewer onClose={handleClose} />;
};

export default AttachmentsViewerScreen;
