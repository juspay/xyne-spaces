import { ReactElement } from 'react';
import DigitalTwinPersonaTab from '@/routes/ClawAgentsScreen/tabs/DigitalTwinPersonaTab';
import { ClawProvidersSettingsPanels } from './ClawProvidersSettingsPanels';

const XyneAISettingsConfigurationTab = (): ReactElement => (
  <>
    <ClawProvidersSettingsPanels />
    <DigitalTwinPersonaTab />
  </>
);

export default XyneAISettingsConfigurationTab;
