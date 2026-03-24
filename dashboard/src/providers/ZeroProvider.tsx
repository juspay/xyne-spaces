import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { dropAllDatabases, UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useAuth } from './AuthProvider';
import { mutators } from '../zero/mutators';
import { schema } from '@xyne/shared';
import { VITE_ZERO_SERVER } from '../config';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

interface ZeroProviderProps {
  children: ReactNode;
}

const ZeroProvider: React.FC<ZeroProviderProps> = ({ children }): ReactElement | null => {
  const { user } = useAuth();
  const isRefreshing = useRef(false);
  const refreshCount = useSelector(stateMachineActor, state => state.context.zeroRefreshCounter);

  const [zero, setZero] = useState<Zero | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Auth function - returns undefined to let Zero use cookies
    // Cookies are sent automatically by the browser
    const authFunction = undefined;

    const handleUpdateNeeded = async (reason: UpdateNeededReason): Promise<void> => {
      if (reason.type === 'SchemaVersionNotSupported' || reason.type === 'VersionNotSupported') {
        isRefreshing.current = true;
        try {
          await dropAllDatabases();
        } catch {
          // Ignore errors during drop
        }
        window.location.reload();
        isRefreshing.current = false;
      }
    };

    const zeroObj = new Zero({
      userID: user.id,
      auth: authFunction,
      server: VITE_ZERO_SERVER,
      schema,
      mutators: mutators,
      hiddenTabDisconnectDelay: 60000,
      context: { userID: user.id },
      maxHeaderLength: 3072,
      onUpdateNeeded: (reason: UpdateNeededReason): void => {
        void handleUpdateNeeded(reason);
      },
    });

    setZero(zeroObj);

    return () => {
      void zeroObj.close();
    };
  }, [user, refreshCount]);

  if (!zero) {
    return null;
  }

  return <ZeroReactProvider zero={zero}>{children}</ZeroReactProvider>;
};

export default ZeroProvider;
