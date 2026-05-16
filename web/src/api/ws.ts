/**
 * WebSocket client — realtime event bus (PR-W6, güncellendi PR-RT-1).
 *
 * Server sends minimal JSON events:
 *   { type, resource_id, actor_user_id?, timestamp }
 *
 * On each event we invalidate the relevant TanStack Query cache keys so
 * components refetch automatically. No optimistic state here — REST is
 * the source of truth.
 *
 * Reconnect: exponential backoff (1s → 2 → 4 → 8 → 16 → 30s cap).
 * Connection lifecycle is managed by WsProvider (src/components/ws-provider.tsx).
 *
 * Auth (PR-RT-1): browser WebSocket can't send Authorization header, and
 * putting the access token in ?access_token= exposes it in proxy/CDN logs.
 * Instead we fetch a short-lived single-use ticket (POST /api/v1/ws/ticket)
 * using the normal Bearer token flow, then pass ?ticket= on the WS URL.
 * Tickets are 32-byte random, 30-second TTL, consumed on first use.
 * A fresh ticket is fetched on every (re-)connect attempt.
 */

import { getAccessToken } from './token-storage';
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

/**
 * Fetch a single-use WS ticket via the REST ticket endpoint.
 * Uses the in-memory access token (from token-storage) directly so we
 * don't need to inject the token again — same Bearer flow as apiFetch.
 */
async function fetchWsTicket(): Promise<string> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new Error('Oturum yok — ticket alınamadı');

  const res = await fetch('/api/v1/ws/ticket', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Ticket endpoint hatası: ${res.status}`);
  }
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
}

function buildWsUrl(ticket: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}/api/v1/ws?ticket=${encodeURIComponent(ticket)}`;
}

function handleEvent(ev: WsEvent) {
  switch (ev.type) {
    case 'folder.created':
    case 'folder.updated':
    case 'folder.deleted':
      // Invalidate all folder list caches; detail cache for the specific folder.
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.folders.detail(ev.resource_id) });
      break;

    case 'item.created':
    case 'item.updated':
    case 'item.deleted':
    case 'item.shared':
    case 'item.unshared':
    case 'item.field_updated':
      // Invalidate item detail + all item lists (we don't know which folder).
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(ev.resource_id) });
      break;

    default:
      break;
  }
}

export class WsClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private statusListeners: Set<StatusListener> = new Set();
  private status: WsStatus = 'connecting';

  constructor() {
    // Kick off async ticket fetch + connect immediately.
    // Status starts as 'connecting' so the UI shows the right indicator.
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

  private async connect() {
    if (this.destroyed) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    // Fetch a fresh single-use ticket for this connect attempt.
    let ticket: string;
    try {
      ticket = await fetchWsTicket();
    } catch {
      // Ticket fetch failed (e.g. network error, access token expired).
      // Schedule reconnect; the refresh interceptor will renew the token.
      this.scheduleReconnect();
      return;
    }

    if (this.destroyed) return; // may have been destroyed while fetching ticket

    try {
      this.socket = new WebSocket(buildWsUrl(ticket), [SUBPROTOCOL]);
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
      // onerror is always followed by onclose; reconnect handled there.
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
