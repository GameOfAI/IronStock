import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('renders total count and current page', () => {
    render(
      <Pagination
        offset={50}
        limit={50}
        total={237}
        onPageChange={() => {}}
        onLimitChange={() => {}}
      />,
    );
    expect(screen.getByText('237')).toBeInTheDocument();
    // page 2 of 5
    expect(screen.getByText('2 / 5')).toBeInTheDocument();
  });

  it('disables prev button on first page', () => {
    render(
      <Pagination
        offset={0}
        limit={50}
        total={100}
        onPageChange={() => {}}
        onLimitChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /önceki/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sonraki/i })).not.toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(
      <Pagination
        offset={50}
        limit={50}
        total={100}
        onPageChange={() => {}}
        onLimitChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /önceki/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /sonraki/i })).toBeDisabled();
  });

  it('calls onPageChange with next/prev offset', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        offset={50}
        limit={50}
        total={200}
        onPageChange={onPageChange}
        onLimitChange={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /sonraki/i }));
    expect(onPageChange).toHaveBeenCalledWith(100);
    await user.click(screen.getByRole('button', { name: /önceki/i }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
