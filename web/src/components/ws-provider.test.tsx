import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ accessToken: 'tok-abc' }),
  ),
}));

vi.mock('@/api/ws', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners = new Set<(d: any) => void>();
  const mockClient = {
    getStatus: vi.fn().mockReturnValue('connecting'),
    getDetail: vi.fn().mockReturnValue({ status: 'connecting', attempt: 0 }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onStatus: vi.fn((cb: (d: any) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    destroy: vi.fn(),
    _emit: (status: string) => listeners.forEach((cb) => cb({ status, attempt: 0 })),
  };
  return {
    // vitest 4: mockReturnValue is not allowed when called with `new`.
    // Arrow functions cannot be constructors; use regular function.
    // Returning an object from a constructor makes `new` return that object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    WsClient: vi.fn().mockImplementation(function(this: any) { Object.assign(this, mockClient); return mockClient; }),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('@/api/ws')) as any;
    render(
      <WsProvider>
        <StatusDisplay />
      </WsProvider>,
    );
    act(() => {
      mod._mockClient._emit('connected');
    });
    expect(screen.getByTestId('status').textContent).toBe('connected');
  });
});
