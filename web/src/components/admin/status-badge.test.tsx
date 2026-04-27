import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders Turkish label for each status', () => {
    const { rerender } = render(<StatusBadge status="active" />);
    expect(screen.getByText('Aktif')).toBeInTheDocument();

    rerender(<StatusBadge status="pending_totp" />);
    expect(screen.getByText('TOTP Bekliyor')).toBeInTheDocument();

    rerender(<StatusBadge status="disabled" />);
    expect(screen.getByText('Devre Dışı')).toBeInTheDocument();

    rerender(<StatusBadge status="locked" />);
    expect(screen.getByText('Kilitli')).toBeInTheDocument();
  });
});
