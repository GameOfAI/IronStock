import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { setAccessToken } from '@/api/token-storage';

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: React.PropsWithChildren) => <div data-testid="mock-select">{children}</div>,
  SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

const fetchMock = vi.fn();

function renderPage() {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccessRequestsPageWrapper />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let AccessRequestsPageWrapper: React.FC;

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
  useAuthStore.setState({
    user: { id: '1', username: 'admin', roles: ['admin'] },
    accessToken: 'test-token',
  });
  const mod = await import('./access-requests');
  const Page = mod.default;
  AccessRequestsPageWrapper = () => <Page />;
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('AccessRequestsPage', () => {
  it('module exports a default component', async () => {
    const mod = await import('./access-requests');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders page heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Onay İstekleri')).toBeInTheDocument();
    });
  });

  it('renders status filter options', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('mock-select')).toBeInTheDocument();
    });
  });
});
