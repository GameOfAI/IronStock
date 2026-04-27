/**
 * WebSocket client — web/src/api/ws.ts ile aynı mantık.
 * Fark: URL, sabit `window.location.host` yerine `getBaseUrl()` ile inşa edilir.
 * Tauri app farklı sunuculara bağlanabilir; WS endpointi de aynı base URL'e gider.
 */

import { getBaseUrl } from './client';
import { queryClient, queryKeys } from './query';

export type WsStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface WsEvent {
  type: string;
  resource_id: string;
  actor_user_id?: string;
  timestamp: string;
}

type StatusListener = (status: WsStatus) => void;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const SUBPROTOCOL = 'envanter.v1';

function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

function buildWsUrl(accessToken: string): string {
  const base = getBaseUrl(); // e.g. "https://ironstock.example.com"
  const wsProto = base.startsWith('https://') ? 'wss://' : 'ws://';
  const withoutProto = base.replace(/^https?:\/\//, '');
  return `${wsProto}${withoutProto}/api/v1/ws?access_token=${encodeURIComponent(accessToken)}`;
}

function handleEvent(ev: WsEvent) {
  switch (ev.type) {
    case 'folder.created':
    case 'folder.updated':
    case 'folder.deleted':
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.detail(ev.resource_id) });
      break;
    case 'item.created':
    case 'item.updated':
    case 'item.deleted':
    case 'item.shared':
    case 'item.unshared':
    case 'item.field_updated':
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(ev.resource_id) });
      break;
    default:
      break;
  }
}

export class WsClient {
  private url: string;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private statusListeners: Set<StatusListener> = new Set();
  private status: WsStatus = 'connecting';

  constructor(accessToken: string) {
    this.url = buildWsUrl(accessToken);
    this.connect();
  }

  private setStatus(s: WsStatus) {
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    try {
      this.socket = new WebSocket(this.url, [SUBPROTOCOL]);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };

    this.socket.onmessage = (e: MessageEvent<string>) => {
      try {
        const ev = JSON.parse(e.data) as WsEvent;
        handleEvent(ev);
      } catch {
        // Malformed frame — ignore.
      }
    };

    this.socket.onclose = () => {
      if (!this.destroyed) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onerror always followed by onclose.
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.setStatus('reconnecting');
    const delay = backoffDelay(this.attempt);
    this.attempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.socket?.close();
    this.setStatus('offline');
    this.statusListeners.clear();
  }
}
