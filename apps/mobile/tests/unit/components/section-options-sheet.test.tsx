import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChannelFilterMode, ChannelSortOrder, type ChannelSection } from '@xyne/shared';
import { SectionOptionsSheet } from '@/src/components/chat/channel-list/section-options-sheet';

jest.mock('@xyne/shared', () => {
  const path = require('node:path');
  return jest.requireActual(path.join(path.dirname(require.resolve('@xyne/shared')), 'zero/types'));
});

const mockUpdateSection = jest.fn();
const mockUpdateGroup = jest.fn();
const mockSection = {
  id: 'section-1',
  name: 'Engineering',
  filterMode: ChannelFilterMode.ALL,
  sortOrder: null,
} as unknown as ChannelSection;
let mockSections: ChannelSection[] = [mockSection];
jest.mock('@/src/hooks/useChannelSections', () => ({
  useChannelSections: () => ({ sections: mockSections, updatePreference: mockUpdateSection }),
}));
jest.mock('@/src/hooks/useChannelGroupPreferences', () => ({
  useChannelGroupPreferences: () => ({
    channels: { filterMode: 'ACTIVE', sortOrder: 'RECENCY' },
    starred: { filterMode: 'ACTIVE', sortOrder: 'UNREAD' },
    update: mockUpdateGroup,
  }),
}));
jest.mock('@/src/components/ui/app-bottom-sheet', () => ({
  AppBottomSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetScrollView: require('react-native').ScrollView,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('uniwind', () => ({ useCSSVariable: () => '#000000' }));
const actions = {
  onClose: jest.fn(),
  onRename: jest.fn(),
  onManageChannels: jest.fn(),
  onCreateSection: jest.fn(),
  onDelete: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSections = [mockSection];
});
describe('section options preferences', () => {
  it('preserves custom actions and saves manual ordering through the section mutation', () => {
    render(
      <SectionOptionsSheet
        target={{ section: mockSection, channelCount: 3, unreadCount: 1 }}
        isOpen
        {...actions}
      />,
    );
    expect(screen.getByText('Rename section')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Sort'));
    expect(screen.getByLabelText('Manual order').props['accessibilityState'].checked).toBe(true);
    fireEvent.press(screen.getByLabelText('Recency'));
    expect(mockUpdateSection).toHaveBeenCalledWith('section-1', {
      sortOrder: ChannelSortOrder.RECENCY,
    });
    fireEvent.press(screen.getByLabelText('Sort'));
    fireEvent.press(screen.getByLabelText('Manual order'));
    expect(mockUpdateSection).toHaveBeenCalledWith('section-1', { sortOrder: null });
  });
  it.each(['channels', 'starred'] as const)('exposes only applicable settings for %s', group => {
    render(
      <SectionOptionsSheet
        target={{ group, channelCount: 3, unreadCount: 1 }}
        isOpen
        {...actions}
      />,
    );
    expect(screen.queryByText('Rename section')).toBeNull();
    expect(screen.queryByText('Delete section')).toBeNull();
    fireEvent.press(screen.getByLabelText('Sort'));
    expect(screen.queryByText('Manual order')).toBeNull();
    fireEvent.press(screen.getByLabelText('Alphabetical A-Z'));
    expect(mockUpdateGroup).toHaveBeenCalledWith(group, {
      sortOrder: ChannelSortOrder.ALPHABETICAL,
    });
    fireEvent.press(screen.getByLabelText('Filter'));
    expect(screen.getByLabelText('Active only').props['accessibilityState'].checked).toBe(true);
    fireEvent.press(screen.getByLabelText('Mentions'));
    expect(mockUpdateGroup).toHaveBeenCalledWith(group, { filterMode: ChannelFilterMode.MENTIONS });
  });
});

it('updates the open sheet from live section preferences and handles a deleted section', () => {
  const props = {
    target: { section: mockSection, channelCount: 3, unreadCount: 1 },
    isOpen: true,
    ...actions,
  };
  const { rerender } = render(<SectionOptionsSheet {...props} />);
  mockSections = [{ ...mockSection, filterMode: ChannelFilterMode.MENTIONS }];
  rerender(<SectionOptionsSheet {...props} />);
  fireEvent.press(screen.getByLabelText('Filter'));
  expect(screen.getByLabelText('Mentions').props['accessibilityState'].checked).toBe(true);
  mockSections = [];
  rerender(<SectionOptionsSheet {...props} />);
  expect(screen.getByText('This section is no longer available.')).toBeTruthy();
  expect(screen.queryByLabelText('Mentions')).toBeNull();
  expect(mockUpdateGroup).not.toHaveBeenCalled();
});

it('resets the settings page when switching groups', () => {
  const { rerender } = render(
    <SectionOptionsSheet
      target={{ group: 'channels', channelCount: 1, unreadCount: 0 }}
      isOpen
      {...actions}
    />,
  );
  fireEvent.press(screen.getByLabelText('Sort'));
  rerender(
    <SectionOptionsSheet
      target={{ group: 'starred', channelCount: 1, unreadCount: 0 }}
      isOpen
      {...actions}
    />,
  );
  expect(screen.getByLabelText('Sort')).toBeTruthy();
  expect(screen.queryByLabelText('Back to section options')).toBeNull();
});
