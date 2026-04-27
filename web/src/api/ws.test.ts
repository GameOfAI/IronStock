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

describe('WsClient', () => {
  it('connects with access_token query param', () => {
    const client = new WsClient('tok-123');
    expect(MockWebSocket.instances[0].url).toContain('access_token=tok-123');
    client.destroy();
  });

  it('starts in connecting status', () => {
    const client = new WsClient('tok');
    expect(client.getStatus()).toBe('connecting');
    client.destroy();
  });

  it('transitions to connected on open', () => {
    const client = new WsClient('tok');
    MockWebSocket.instances[0].simulateOpen();
    expect(client.getStatus()).toBe('connected');
    client.destroy();
  });

  it('transitions to reconnecting on close, retries after backoff', () => {
    const client = new WsClient('tok');
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();
    expect(client.getStatus()).toBe('reconnecting');
    // Backoff attempt 0 = 1s
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances.length).toBe(2);
    client.destroy();
  });

  it('notifies status listeners', () => {
    const client = new WsClient('tok');
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();
    expect(statuses).toEqual(['connected', 'reconnecting']);
    client.destroy();
  });

  it('destroy stops reconnect timer and sets offline', () => {
    const client = new WsClient('tok');
    client.destroy();
    expect(client.getStatus()).toBe('offline');
    // No new socket after destroy even if timer fires
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it('ignores malformed JSON messages', () => {
    const client = new WsClient('tok');
    MockWebSocket.instances[0].simulateOpen();
    // Should not throw
    expect(() => {
      MockWebSocket.instances[0].simulateMessage('not-json{{{');
    }).not.toThrow();
    client.destroy();
  });
});
