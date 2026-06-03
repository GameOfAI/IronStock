import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminSSOPage from './sso';
import { useAuthStore } from '@/store/auth';
import { setAccessToken } from '@/api/token-storage';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminSSOPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  setAccessToken('test-token');
  useAuthStore.setState({
    user: { id: '1', username: 'admin', roles: ['admin'] },
    accessToken: 'test-token',
  });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('AdminSSOPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { providers: [] }));
    renderPage();
    expect(screen.getByText('SSO / LDAP')).toBeInTheDocument();
  });

  it('shows add provider button', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { providers: [] }));
    renderPage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders provider list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        providers: [
          {
            id: 'p1', name: 'Azure AD', provider_type: 'oidc',
            enabled: true, auto_provision: true, default_role: 'read',
          },
          {
            id: 'p2', name: 'Corp LDAP', provider_type: 'ldap',
            enabled: true, auto_provision: false, default_role: 'read',
          },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Azure AD')).toBeInTheDocument();
      expect(screen.getByText('Corp LDAP')).toBeInTheDocument();
    });
  });
});
