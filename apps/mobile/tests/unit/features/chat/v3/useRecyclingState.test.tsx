import { describe, expect, it } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { type Dispatch, type ReactElement, type SetStateAction } from 'react';

import { useRecyclingState } from '@/src/features/chat/v3/rows/useRecyclingState';

type ProbeProps = {
  rowKey: string;
  onRender: (value: number) => void;
  onSetter: (setter: Dispatch<SetStateAction<number>>) => void;
};

const Probe = ({ rowKey, onRender, onSetter }: ProbeProps): ReactElement => {
  const [value, setValue] = useRecyclingState(rowKey, 0);
  onRender(value);
  onSetter(setValue);
  return <>{value}</>;
};

const mount = (
  rowKey: string,
  onRender: (value: number) => void,
  onSetter: (setter: Dispatch<SetStateAction<number>>) => void,
): ReactTestRenderer => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe rowKey={rowKey} onRender={onRender} onSetter={onSetter} />);
  });
  return renderer;
};

describe('useRecyclingState', () => {
  it('returns the initial value immediately when a cell receives a new row key', () => {
    const renders: number[] = [];
    let setValue!: Dispatch<SetStateAction<number>>;
    const renderer = mount(
      'row-a',
      value => renders.push(value),
      setter => (setValue = setter),
    );

    act(() => setValue(7));
    renders.length = 0;

    act(() => {
      renderer.update(
        <Probe
          rowKey='row-b'
          onRender={value => renders.push(value)}
          onSetter={setter => (setValue = setter)}
        />,
      );
    });

    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every(value => value === 0)).toBe(true);
    act(() => renderer.unmount());
  });

  it('preserves state while the row key remains stable', () => {
    const renders: number[] = [];
    let setValue!: Dispatch<SetStateAction<number>>;
    const renderer = mount(
      'row-a',
      value => renders.push(value),
      setter => (setValue = setter),
    );

    act(() => setValue(7));
    renders.length = 0;

    act(() => {
      renderer.update(
        <Probe
          rowKey='row-a'
          onRender={value => renders.push(value)}
          onSetter={setter => (setValue = setter)}
        />,
      );
    });

    expect(renders).toEqual([7]);
    act(() => renderer.unmount());
  });
});
