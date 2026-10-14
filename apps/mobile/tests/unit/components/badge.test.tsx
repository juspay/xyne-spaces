import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Badge } from '@/src/components/ui/badge/badge';

describe('Badge', () => {
  it('renders the label text', () => {
    render(<Badge label='Replies' />);
    expect(screen.getByText('Replies')).toBeTruthy();
  });

  it('renders the count when count > 0', () => {
    render(<Badge label='Replies' count={5} />);
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('caps counts above 99 as "99+"', () => {
    render(<Badge label='Replies' count={128} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('does not render count when count is 0', () => {
    render(<Badge label='Replies' count={0} />);
    expect(screen.getByText('Replies')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('does not render count when count is undefined', () => {
    render(<Badge label='Replies' />);
    expect(screen.getByText('Replies')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    render(<Badge label='Replies' onPress={onPress} />);
    fireEvent.press(screen.getByText('Replies'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
