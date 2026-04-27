import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { ItemSearch } from './item-search';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ItemSearch', () => {
  it('debounces commit by 300ms', () => {
    const onCommit = vi.fn();
    render(<ItemSearch initial="" onCommit={onCommit} />);
    const input = screen.getByLabelText(/item ara/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'mysql' } });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenCalledWith('mysql');
  });

  it('clear button empties input and commits empty after debounce', () => {
    const onCommit = vi.fn();
    render(<ItemSearch initial="mysql" onCommit={onCommit} />);

    const clear = screen.getByRole('button', { name: /aramayı temizle/i });
    fireEvent.click(clear);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenLastCalledWith('');
  });

  it('does not show clear button when empty', () => {
    render(<ItemSearch initial="" onCommit={() => {}} />);
    expect(screen.queryByRole('button', { name: /aramayı temizle/i })).not.toBeInTheDocument();
  });

  it('disables input + clear when disabled', () => {
    render(<ItemSearch initial="abc" onCommit={() => {}} disabled />);
    expect(screen.getByLabelText(/item ara/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /aramayı temizle/i })).toBeDisabled();
  });
});
