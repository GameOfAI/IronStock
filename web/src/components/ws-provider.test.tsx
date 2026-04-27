import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ accessToken: 'tok-abc' }),
  ),
}));

vi.mock('@/api/ws', () => {
  const listeners = new Set<(s: string) => void>();
  const mockClient = {
    getStatus: vi.fn().mockReturnValue('connecting'),
    onStatus: vi.fn((cb: (s: string) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    destroy: vi.fn(),
    _emit: (s: string) => listeners.forEach((cb) => cb(s)),
  };
  return {
    WsClient: vi.fn().mockReturnValue(mockClient),
    _mockClient: mockClient,
  };
});

import { WsProvider, useWsStatus } from './ws-provider';

function StatusDisplay() {
  const status = useWsStatus();
  return <div data-testid="status">{status}</div>;
}

describe('WsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders children', () => {
    render(
      <WsProvider>
        <span>hello</span>
      </WsProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('exposes initial status via useWsStatus', () => {
    render(
      <WsProvider>
        <StatusDisplay />
      </WsProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('connecting');
  });

  it('updates status when client emits', async () => {
    const { _mockClient } = await import('@/api/ws');
    render(
      <WsProvider>
        <StatusDisplay />
      </WsProvider>,
    );
    act(() => {
      (_mockClient as { _emit: (s: string) => void })._emit('connected');
    });
    expect(screen.getByTestId('status').textContent).toBe('connected');
  });
});
