import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from './ws';

// Minimal WebSocket mock
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  protocol: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0; // CONNECTING

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocol = Array.isArray(protocols) ? protocols[0] : (protocols ?? '');
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// WsClient (PR-RT-1): connection goes through a ticket fetch before opening
// the WebSocket, so tests verify status transitions and lifecycle only.
// The ticket endpoint is not exercised in unit tests (integration concern).

describe('WsClient', () => {
  it('starts in connecting status', () => {
    const client = new WsClient();
    expect(client.getStatus()).toBe('connecting');
    client.destroy();
  });

  it('destroy sets offline immediately', () => {
    const client = new WsClient();
    client.destroy();
    expect(client.getStatus()).toBe('offline');
    // No new socket created after destroy even if timer fires
    vi.advanceTimersByTime(5000);
    // No sockets opened since ticket fetch is async and we destroyed immediately
    client.destroy(); // idempotent
  });

  it('onStatus registers and unregisters listeners', () => {
    const client = new WsClient();
    const statuses: string[] = [];
    const unsub = client.onStatus((s) => statuses.push(s));
    unsub();
    // Listeners unregistered — no status changes should arrive
    client.destroy();
    expect(statuses).toEqual([]);
  });
});
