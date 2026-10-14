import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

jest.mock('uniwind', () => ({
  useCSSVariable: () => '#111111',
}));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text: RNText } = require('react-native') as typeof import('react-native');
  return {
    MoreVertical: () => React.createElement(RNText, null, 'more'),
    Trash2: () => React.createElement(RNText, null, 'trash'),
    UserMinus: () => React.createElement(RNText, null, 'user-minus'),
    UserPlus: () => React.createElement(RNText, null, 'user-plus'),
  };
});

const dropdownMountIds: string[] = [];

let capturedOnClosed: (() => void) | undefined;

jest.mock('@/src/components/ui/dropdown', () => {
  const React = require('react') as typeof import('react');
  const RN = require('react-native') as typeof import('react-native');

  function DropdownRoot({ children, onClosed }: { children: ReactNode; onClosed?: () => void }) {
    capturedOnClosed = onClosed;
    React.useEffect(() => {
      dropdownMountIds.push('mount');
    }, []);
    return React.createElement(RN.View, { testID: 'member-actions-dropdown' }, children);
  }

  DropdownRoot.Trigger = ({
    children,
    ...props
  }: {
    children: ReactNode;
    accessibilityLabel?: string;
  }) => React.createElement(RN.Pressable, props, children);
  DropdownRoot.Content = ({ children }: { children: ReactNode }) =>
    React.createElement(RN.View, null, children);
  DropdownRoot.Item = ({ label, onSelect }: { label: string; onSelect?: () => void }) =>
    React.createElement(
      RN.Pressable,
      { onPress: onSelect },
      React.createElement(RN.Text, null, label),
    );

  return { Dropdown: DropdownRoot };
});

import { MemberActionsMenu } from '@/src/features/chat/channel-members/member-actions-menu.android';
import type { MemberAction } from '@/src/features/chat/channel-members/channel-member-actions';

const ACTIONS: MemberAction[] = [
  {
    id: 'make-admin',
    label: 'Make admin',
    systemImage: 'person.badge.plus',
    destructive: false,
  },
  {
    id: 'remove',
    label: 'Remove',
    systemImage: 'trash',
    destructive: true,
  },
];

describe('MemberActionsMenu android recycle', () => {
  it('remounts the dropdown when a recycled row binds a different member', () => {
    dropdownMountIds.length = 0;
    const onAction = jest.fn();

    const { rerender } = render(
      <MemberActionsMenu userId='user-1' memberName='Ada' actions={ACTIONS} onAction={onAction} />,
    );
    expect(dropdownMountIds).toHaveLength(1);

    rerender(
      <MemberActionsMenu userId='user-2' memberName='Bob' actions={ACTIONS} onAction={onAction} />,
    );
    expect(dropdownMountIds).toHaveLength(2);
  });

  it('keeps the same dropdown instance while the same member stays bound', () => {
    dropdownMountIds.length = 0;
    const onAction = jest.fn();

    const { rerender } = render(
      <MemberActionsMenu userId='user-1' memberName='Ada' actions={ACTIONS} onAction={onAction} />,
    );
    rerender(
      <MemberActionsMenu
        userId='user-1'
        memberName='Ada Lovelace'
        actions={ACTIONS}
        onAction={onAction}
      />,
    );
    expect(dropdownMountIds).toHaveLength(1);
  });

  it('invokes Remove only after the dropdown has finished closing', () => {
    const onAction = jest.fn();
    render(
      <MemberActionsMenu userId='user-1' memberName='Ada' actions={ACTIONS} onAction={onAction} />,
    );

    fireEvent.press(screen.getByText('Remove'));
    expect(onAction).not.toHaveBeenCalled();

    capturedOnClosed?.();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('remove');
  });

  it('invokes Make admin immediately', () => {
    const onAction = jest.fn();
    render(
      <MemberActionsMenu userId='user-1' memberName='Ada' actions={ACTIONS} onAction={onAction} />,
    );

    fireEvent.press(screen.getByText('Make admin'));
    expect(onAction).toHaveBeenCalledWith('make-admin');
  });
});
