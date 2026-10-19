/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { EtaManagementView } from '@xyne/shared';

jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentBg: '#111111', accentFg: '#ffffff' }),
}));

import { EtaAcknowledgeBanner } from '@/src/screens/ticket-details/eta-acknowledge-banner';

function view(partial: Partial<EtaManagementView> = {}): EtaManagementView {
  return {
    autoEnabled: true,
    forecastStatus: 'COMPLETE',
    forecastIncompleteReason: null,
    planningRiskState: 'ACTIVE',
    isPaused: false,
    severity: 'PLANNING_RISK',
    stageDeadline: new Date(2024, 8, 18, 10, 0).getTime(),
    ticketDue: new Date(2024, 8, 17, 10, 0).getTime(),
    ...partial,
  };
}

describe('EtaAcknowledgeBanner', () => {
  it('returns null unless planning risk is ACTIVE', () => {
    const { toJSON: none } = render(
      <EtaAcknowledgeBanner
        view={view({ severity: 'NONE' })}
        onAcknowledge={jest.fn<(reason: string) => Promise<boolean>>()}
      />,
    );
    expect(none()).toBeNull();

    const { toJSON: acknowledged } = render(
      <EtaAcknowledgeBanner
        view={view({ planningRiskState: 'ACKNOWLEDGED' })}
        onAcknowledge={jest.fn<(reason: string) => Promise<boolean>>()}
      />,
    );
    expect(acknowledged()).toBeNull();
  });

  it('shows planning risk copy with formatted deadlines', () => {
    render(
      <EtaAcknowledgeBanner
        view={view()}
        onAcknowledge={jest.fn<(reason: string) => Promise<boolean>>()}
      />,
    );

    expect(screen.getByText('Planning risk')).toBeTruthy();
    expect(
      screen.getByText(
        /stage deadline \(18 Sep, 10:00 AM\).*ticket due date \(17 Sep, 10:00 AM\)/s,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Automatic recalculation is active/)).toBeTruthy();
  });

  it('requires a reason before confirming acknowledge', async () => {
    const onAcknowledge = jest.fn(async () => true);
    render(<EtaAcknowledgeBanner view={view()} onAcknowledge={onAcknowledge} />);

    fireEvent.press(screen.getByLabelText('Acknowledge planning risk'));
    fireEvent.press(screen.getByText('Confirm'));
    expect(onAcknowledge).not.toHaveBeenCalled();

    fireEvent.changeText(
      screen.getByLabelText('Acknowledge planning risk reason'),
      'Keeping dates intentionally',
    );
    fireEvent.press(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(onAcknowledge).toHaveBeenCalledWith('Keeping dates intentionally');
    });
  });
});
