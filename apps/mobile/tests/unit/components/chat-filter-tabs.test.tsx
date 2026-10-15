import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  ChatFilterTabs,
  type ChatFilterTabOption,
} from '@/src/components/chat/chat-filter-tabs/chat-filter-tabs';

describe('ChatFilterTabs', () => {
  const tabs: ChatFilterTabOption<string>[] = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread', count: 3 },
    { value: 'mentions', label: 'Mentions', count: 0 },
  ];

  it('renders all tab labels', () => {
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={jest.fn()} />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Unread')).toBeTruthy();
    expect(screen.getByText('Mentions')).toBeTruthy();
  });

  it('calls onTabChange with correct value when pressing an inactive tab', () => {
    const onTabChange = jest.fn();
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={onTabChange} />);
    fireEvent.press(screen.getByText('Unread'));
    expect(onTabChange).toHaveBeenCalledWith('unread');
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it('calls onTabChange even when pressing the active tab', () => {
    const onTabChange = jest.fn();
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={onTabChange} />);
    fireEvent.press(screen.getByText('All'));
    expect(onTabChange).toHaveBeenCalledWith('all');
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });

  it('renders count for tab with count > 0', () => {
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={jest.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('does not render count for tab with count = 0', () => {
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={jest.fn()} />);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders with scrollable=true without crashing', () => {
    render(<ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={jest.fn()} scrollable />);
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Unread')).toBeTruthy();
  });

  it('switches active tab when pressed', () => {
    const onTabChange = jest.fn();
    const { rerender } = render(
      <ChatFilterTabs tabs={tabs} activeTab='all' onTabChange={onTabChange} />,
    );

    fireEvent.press(screen.getByText('Mentions'));
    expect(onTabChange).toHaveBeenCalledWith('mentions');

    // Simulate parent updating activeTab after callback
    rerender(<ChatFilterTabs tabs={tabs} activeTab='mentions' onTabChange={onTabChange} />);

    // Now pressing 'All' should trigger onTabChange with 'all'
    fireEvent.press(screen.getByText('All'));
    expect(onTabChange).toHaveBeenCalledWith('all');
  });

  it('renders single tab', () => {
    const singleTab: ChatFilterTabOption<string>[] = [{ value: 'only', label: 'Only Tab' }];
    render(<ChatFilterTabs tabs={singleTab} activeTab='only' onTabChange={jest.fn()} />);
    expect(screen.getByText('Only Tab')).toBeTruthy();
  });
});
