/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { EtaManagementView } from '@xyne/shared';

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AlertCircle: () => React.createElement(View, { testID: 'alert-circle' }),
  };
});

import { EtaManagementBadges } from '@/src/screens/ticket-details/eta-management-badges';

function view(partial: Partial<EtaManagementView>): EtaManagementView {
  return {
    autoEnabled: false,
    forecastStatus: 'COMPLETE',
    forecastIncompleteReason: null,
    planningRiskState: 'NONE',
    isPaused: false,
    severity: 'NONE',
    stageDeadline: null,
    ticketDue: null,
    ...partial,
  };
}

describe('EtaManagementBadges', () => {
  it('renders nothing when there are no badges to show', () => {
    const { toJSON } = render(<EtaManagementBadges view={view({})} />);
    expect(toJSON()).toBeNull();
  });

  it('shows Overdue when requested', () => {
    render(<EtaManagementBadges view={view({})} showOverdue />);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('shows Planning Risk and paused suffix', () => {
    render(<EtaManagementBadges view={view({ severity: 'PLANNING_RISK', isPaused: true })} />);
    expect(screen.getByText('Planning Risk (paused)')).toBeTruthy();
  });

  it('shows Estimate Incomplete from forecast status', () => {
    render(<EtaManagementBadges view={view({ forecastStatus: 'INCOMPLETE' })} />);
    expect(screen.getByText('Estimate Incomplete')).toBeTruthy();
  });
});
