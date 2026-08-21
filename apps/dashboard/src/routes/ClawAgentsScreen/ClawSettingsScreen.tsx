import { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';

/** Legacy route shim — provider settings now live under Xyne AI settings. */
const ClawSettingsScreen = (): ReactElement => (
  <Navigate to='../ai/settings/configuration' replace />
);

export default ClawSettingsScreen;
