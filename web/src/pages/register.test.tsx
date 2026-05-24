import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterPage from './register';

const fetchMock = vi.fn();

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RegisterPage />
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

describe('RegisterPage', () => {
  it('renders registration heading', () => {
    renderPage();
    expect(screen.getAllByText('Kayıt Ol').length).toBeGreaterThanOrEqual(1);
  });

  it('renders username label', () => {
    renderPage();
    expect(screen.getByLabelText(/kullanıcı adı/i)).toBeInTheDocument();
  });

  it('renders submit button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /kayıt ol/i })).toBeInTheDocument();
  });
});
