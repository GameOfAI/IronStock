// IronStock k6 yük testi senaryoları
// Kullanım: k6 run e2e/load/scenarios.js --env BASE_URL=http://localhost:8080
//
// Gereksinimler:
//   - Çalışan IronStock API sunucusu
//   - Test kullanıcısı (admin / şifre ortam değişkeninden)
//   - k6 kurulu (https://k6.io)

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const USERNAME = __ENV.USERNAME || 'admin';
const PASSWORD = __ENV.PASSWORD || 'admin';

const loginLatency = new Trend('login_latency', true);
const searchLatency = new Trend('search_latency', true);
const crudLatency = new Trend('crud_latency', true);
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    // Senaryo 1: Login burst — 50 eşzamanlı login, 30 saniye
    login_burst: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
      exec: 'loginBurst',
      tags: { scenario: 'login_burst' },
    },

    // Senaryo 2: CRUD işlemleri — kademeli artış
    crud_operations: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'crudOperations',
      startTime: '35s',
      tags: { scenario: 'crud' },
    },

    // Senaryo 3: Arama yükü — sabit 30 VU
    search_load: {
      executor: 'constant-vus',
      vus: 30,
      duration: '2m',
      exec: 'searchLoad',
      startTime: '35s',
      tags: { scenario: 'search' },
    },

    // Senaryo 4: WebSocket bağlantıları — 1000'e kadar
    ws_connections: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      exec: 'wsConnections',
      startTime: '4m',
      tags: { scenario: 'websocket' },
    },
  },

  thresholds: {
    // SLO hedefleri (docs/ops/slo.md ile eşleşir)
    'login_latency': ['p(95)<1000', 'p(99)<2000'],
    'search_latency': ['p(95)<300', 'p(99)<1000'],
    'crud_latency': ['p(95)<200', 'p(99)<500'],
    'error_rate': ['rate<0.001'],
    'http_req_duration{scenario:login_burst}': ['p(95)<1000'],
    'http_req_duration{scenario:crud}': ['p(95)<200'],
    'http_req_duration{scenario:search}': ['p(95)<300'],
  },
};

function login() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  return res;
}

function getAccessToken() {
  const res = login();
  if (res.status === 200) {
    const body = JSON.parse(res.body);
    return body.access_token;
  }
  return null;
}

// --- Senaryo 1: Login Burst ---
export function loginBurst() {
  group('Login Burst', () => {
    const res = login();
    loginLatency.add(res.timings.duration);
    const success = check(res, {
      'login status 200': (r) => r.status === 200,
      'login has access_token': (r) => {
        if (r.status !== 200) return false;
        const body = JSON.parse(r.body);
        return !!body.access_token;
      },
    });
    errorRate.add(!success);
    sleep(0.5);
  });
}

// --- Senaryo 2: CRUD İşlemleri ---
export function crudOperations() {
  const token = getAccessToken();
  if (!token) {
    errorRate.add(true);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  group('CRUD Operations', () => {
    // Klasör listesi
    const foldersRes = http.get(`${BASE_URL}/api/v1/folders`, { headers });
    crudLatency.add(foldersRes.timings.duration);
    check(foldersRes, { 'folders 200': (r) => r.status === 200 });
    errorRate.add(foldersRes.status >= 500);

    // Item listesi (ilk klasörden)
    if (foldersRes.status === 200) {
      const folders = JSON.parse(foldersRes.body);
      if (folders.length > 0) {
        const folderId = folders[0].id;

        const itemsRes = http.get(
          `${BASE_URL}/api/v1/folders/${folderId}/items`,
          { headers },
        );
        crudLatency.add(itemsRes.timings.duration);
        check(itemsRes, { 'items 200': (r) => r.status === 200 });
        errorRate.add(itemsRes.status >= 500);
      }
    }

    // Field definitions
    const fieldsRes = http.get(`${BASE_URL}/api/v1/field-definitions`, { headers });
    crudLatency.add(fieldsRes.timings.duration);
    check(fieldsRes, { 'fields 200': (r) => r.status === 200 });
    errorRate.add(fieldsRes.status >= 500);

    sleep(1);
  });
}

// --- Senaryo 3: Arama Yükü ---
export function searchLoad() {
  const token = getAccessToken();
  if (!token) {
    errorRate.add(true);
    return;
  }

  const headers = { 'Authorization': `Bearer ${token}` };
  const searchTerms = ['mysql', 'prod', 'api', 'ssh', 'admin', 'key', 'cert', 'token'];

  group('Search Load', () => {
    const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];

    // Substring arama
    const subRes = http.get(
      `${BASE_URL}/api/v1/items/search?q=${term}`,
      { headers },
    );
    searchLatency.add(subRes.timings.duration);
    check(subRes, { 'search 200': (r) => r.status === 200 });
    errorRate.add(subRes.status >= 500);

    // Fuzzy arama (trigram)
    const fuzzyRes = http.get(
      `${BASE_URL}/api/v1/items/search?q=${term}&fuzzy=true`,
      { headers },
    );
    searchLatency.add(fuzzyRes.timings.duration);
    check(fuzzyRes, { 'fuzzy search 200': (r) => r.status === 200 });
    errorRate.add(fuzzyRes.status >= 500);

    sleep(0.5);
  });
}

// --- Senaryo 4: WebSocket Bağlantıları ---
export function wsConnections() {
  const token = getAccessToken();
  if (!token) {
    errorRate.add(true);
    return;
  }

  // WS ticket al
  const ticketRes = http.post(
    `${BASE_URL}/api/v1/ws/ticket`,
    null,
    { headers: { 'Authorization': `Bearer ${token}` } },
  );

  if (ticketRes.status !== 200) {
    errorRate.add(true);
    return;
  }

  const ticket = JSON.parse(ticketRes.body).ticket;
  const wsUrl = BASE_URL.replace('http', 'ws');

  const res = ws.connect(
    `${wsUrl}/api/v1/ws?ticket=${ticket}`,
    { headers: { 'Sec-WebSocket-Protocol': 'envanter.v1' } },
    function (socket) {
      socket.on('open', () => {
        // Bağlantıyı 10-30 saniye açık tut
        const holdTime = 10 + Math.random() * 20;
        socket.setTimeout(() => {
          socket.close();
        }, holdTime * 1000);
      });

      socket.on('message', () => {
        // Mesaj alındı — başarılı fan-out
      });

      socket.on('error', () => {
        errorRate.add(true);
      });
    },
  );

  check(res, { 'ws status 101': (r) => r && r.status === 101 });
}
