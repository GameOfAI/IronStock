import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LogForwardingPage from './log-forwarding';
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
        <LogForwardingPage />
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

describe('LogForwardingPage', () => {
  it('renders page heading', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { configs: [] }));
    renderPage();
    expect(screen.getByText('Log Yönlendirme')).toBeInTheDocument();
  });

  it('renders config list when data available', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        configs: [
          { id: 'lf1', target_type: 'syslog', enabled: true, config: { host: 'syslog.local', port: 514 } },
          { id: 'lf2', target_type: 'slack', enabled: false, config: { webhook_url: 'https://hooks.slack.com/...' } },
        ],
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/syslog/i)).toBeInTheDocument();
    });
  });
});
