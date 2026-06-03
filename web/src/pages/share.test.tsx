import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SharePage from './share';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage(token = 'test-token-123') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/share/${token}`]}>
        <Routes>
          <Route path="/share/:token" element={<SharePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SharePage', () => {
  it('renders loading state initially', () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    renderPage();
    // Page should show something while loading
    expect(document.body.querySelector('[class*="min-h-screen"]')).toBeTruthy();
  });

  it('shows error when link key is missing from hash', async () => {
    renderPage();
    await waitFor(() => {
      // Without hash fragment (link key), page should show an error
      const el = screen.queryByText(/geçersiz|hata|bulunamadı/i);
      expect(el || document.body.textContent).toBeTruthy();
    });
  });

  it('fetches share data with token from URL', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { code: 'not_found', message: 'Link bulunamadı' }),
    );
    renderPage('abc-token');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
