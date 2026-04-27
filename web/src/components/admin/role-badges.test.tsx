import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleBadges } from './role-badges';

describe('RoleBadges', () => {
  it('renders em-dash placeholder when roles array is empty', () => {
    render(<RoleBadges roles={[]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders all granted roles', () => {
    render(<RoleBadges roles={['write', 'admin']} />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('orders admin first then write then read', () => {
    render(<RoleBadges roles={['read', 'admin', 'write']} />);
    const badges = screen.getAllByText(/admin|write|read/);
    expect(badges.map((el) => el.textContent)).toEqual(['admin', 'write', 'read']);
  });
});
