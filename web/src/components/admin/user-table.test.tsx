import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserTable } from './user-table';
import { sampleUsers } from './__fixtures__';

// Mutations are imported by UserActionsMenu; mock them so the table renders
// without trying to hit the network when the actions trigger renders.
vi.mock('@/api/admin', () => ({
  useGrantRoleMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeRoleMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisableUserMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useEnableUserMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useResetTOTPMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateTOTPRequirementMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function renderTable(props: Parameters<typeof UserTable>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UserTable {...props} />
    </QueryClientProvider>,
  );
}

describe('UserTable', () => {
  it('renders all users with username + email', () => {
    renderTable({ users: sampleUsers, isLoading: false });
    expect(screen.getByText('burak')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('burak@example.com')).toBeInTheDocument();
  });

  it('renders empty state when users array is empty', () => {
    renderTable({ users: [], isLoading: false });
    expect(screen.getByText('Hiç kullanıcı bulunamadı.')).toBeInTheDocument();
  });

  it('renders skeleton rows while loading initial data', () => {
    const { container } = renderTable({ users: undefined, isLoading: true });
    expect(screen.queryByText('Hiç kullanıcı bulunamadı.')).not.toBeInTheDocument();
    // Skeletons rendered as divs with role=presentation; just check there are rows
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('renders fallback for users that never logged in', () => {
    renderTable({ users: sampleUsers, isLoading: false });
    expect(screen.getByText('Hiç giriş yapmadı')).toBeInTheDocument();
  });
});
