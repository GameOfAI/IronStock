import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFoundPage from './not-found';

function renderPage() {
  return render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
}

describe('NotFoundPage', () => {
  it('renders heading', () => {
    renderPage();
    expect(screen.getByText('Sayfa Bulunamadı')).toBeInTheDocument();
  });

  it('shows descriptive message', () => {
    renderPage();
    expect(screen.getByText('Aradığınız sayfa mevcut değil.')).toBeInTheDocument();
  });

  it('renders link back to inventory', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /envantere dön/i });
    expect(link).toHaveAttribute('href', '/inventory');
  });
});
