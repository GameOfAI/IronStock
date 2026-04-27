import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionBadge } from './permission-badge';

describe('PermissionBadge', () => {
  it('renders "write" label by default', () => {
    render(<PermissionBadge permission="write" />);
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('renders "read" label by default', () => {
    render(<PermissionBadge permission="read" />);
    expect(screen.getByText('read')).toBeInTheDocument();
  });

  it('renders compact "W"/"R" letters when compact=true', () => {
    const { rerender } = render(<PermissionBadge permission="write" compact />);
    expect(screen.getByText('W')).toBeInTheDocument();
    rerender(<PermissionBadge permission="read" compact />);
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('renders nothing when permission is empty', () => {
    const { container } = render(<PermissionBadge permission="" />);
    expect(container.firstChild).toBeNull();
  });
});
