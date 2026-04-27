import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditFilters, EMPTY_FILTERS } from './audit-filters';
import type { AuditFilterState } from './audit-filters';
import { sampleUsers } from './__fixtures__';

function setup(initial: AuditFilterState = EMPTY_FILTERS) {
  const onChange = vi.fn();
  render(<AuditFilters value={initial} onChange={onChange} users={sampleUsers} />);
  return { onChange };
}

describe('AuditFilters', () => {
  it('does not show Clear button when no filter applied', () => {
    setup();
    expect(screen.queryByText(/filtreyi temizle/i)).not.toBeInTheDocument();
  });

  it('shows Clear button when at least one filter is set', () => {
    setup({ ...EMPTY_FILTERS, action: 'auth.login' });
    expect(screen.getByText(/filtreyi temizle/i)).toBeInTheDocument();
  });

  it('calls onChange with EMPTY_FILTERS when Clear is clicked', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ ...EMPTY_FILTERS, action: 'auth.login' });
    await user.click(screen.getByText(/filtreyi temizle/i));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it('renders datetime-local inputs with mapped values', () => {
    const isoUtc = '2026-04-27T12:00:00.000Z';
    setup({ ...EMPTY_FILTERS, from: isoUtc });
    const fromInput = screen.getByLabelText(/başlangıç/i) as HTMLInputElement;
    // Lokal zaman dilimine çevrildiği için saat değişebilir; format YYYY-MM-DDTHH:mm
    expect(fromInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
