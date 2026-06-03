import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chrome.storage.local
const storageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((keys) => {
        const result = {};
        for (const key of keys) {
          if (storageData[key] !== undefined) result[key] = storageData[key];
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((obj) => {
        Object.assign(storageData, obj);
        return Promise.resolve();
      }),
      remove: vi.fn((keys) => {
        for (const key of keys) delete storageData[key];
        return Promise.resolve();
      }),
    },
  },
};

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

let api;

beforeEach(async () => {
  Object.keys(storageData).forEach((k) => delete storageData[k]);
  fetchMock.mockReset();
  vi.resetModules();
  api = await import('./api-client.js');
});

describe('api-client', () => {
  describe('getConfig', () => {
    it('returns empty config when storage is empty', async () => {
      const config = await api.getConfig();
      expect(config.serverUrl).toBe('');
      expect(config.accessToken).toBe('');
      expect(config.refreshToken).toBe('');
    });

    it('returns stored config', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'tok123';
      storageData['ironstock_refresh_token'] = 'ref456';

      const config = await api.getConfig();
      expect(config.serverUrl).toBe('https://vault.test');
      expect(config.accessToken).toBe('tok123');
      expect(config.refreshToken).toBe('ref456');
    });
  });

  describe('saveConfig', () => {
    it('saves all config keys to storage', async () => {
      await api.saveConfig({
        serverUrl: 'https://vault.test',
        accessToken: 'tok',
        refreshToken: 'ref',
      });
      expect(storageData['ironstock_server_url']).toBe('https://vault.test');
      expect(storageData['ironstock_access_token']).toBe('tok');
      expect(storageData['ironstock_refresh_token']).toBe('ref');
    });
  });

  describe('clearConfig', () => {
    it('removes all config keys from storage', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'tok';
      await api.clearConfig();
      expect(chrome.storage.local.remove).toHaveBeenCalled();
    });
  });

  describe('isAuthenticated', () => {
    it('returns false when not configured', async () => {
      const result = await api.isAuthenticated();
      expect(result).toBe(false);
    });

    it('returns true when server URL and token are set', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'tok123';
      const result = await api.isAuthenticated();
      expect(result).toBe(true);
    });
  });

  describe('login', () => {
    it('sends login request and saves tokens on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        }),
      });

      const result = await api.login('https://vault.test', 'admin', 'pass123');
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vault.test/api/v1/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'admin', password: 'pass123' }),
        }),
      );
      expect(storageData['ironstock_access_token']).toBe('new-access');
    });

    it('returns totpRequired when TOTP is needed', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ totp_required: true }),
      });

      const result = await api.login('https://vault.test', 'admin', 'pass123');
      expect(result.totpRequired).toBe(true);
    });

    it('sends TOTP code when provided', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'tok',
          refresh_token: 'ref',
        }),
      });

      await api.login('https://vault.test', 'admin', 'pass123', '123456');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.totp_code).toBe('123456');
    });

    it('throws on failed login', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('invalid credentials'),
      });

      await expect(api.login('https://vault.test', 'admin', 'bad')).rejects.toThrow('Giriş başarısız');
    });
  });

  describe('logout', () => {
    it('calls logout API and clears config', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'tok';
      storageData['ironstock_refresh_token'] = 'ref';

      fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });
      await api.logout();
      expect(chrome.storage.local.remove).toHaveBeenCalled();
    });
  });

  describe('searchItems', () => {
    it('calls search API with encoded query', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'tok';

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: '1', name: 'test' }]),
      });

      const results = await api.searchItems('my query');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vault.test/api/v1/items/search?q=my%20query',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer tok',
          }),
        }),
      );
      expect(results).toEqual([{ id: '1', name: 'test' }]);
    });
  });

  describe('token refresh', () => {
    it('refreshes token on 401 and retries', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'old-tok';
      storageData['ironstock_refresh_token'] = 'ref';

      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 401 }) // initial 401
        .mockResolvedValueOnce({ // refresh success
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-tok',
            refresh_token: 'new-ref',
          }),
        })
        .mockResolvedValueOnce({ // retry success
          ok: true,
          json: () => Promise.resolve([]),
        });

      const result = await api.searchItems('test');
      expect(result).toEqual([]);
      expect(storageData['ironstock_access_token']).toBe('new-tok');
    });

    it('clears config and throws when refresh fails', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'old-tok';
      storageData['ironstock_refresh_token'] = 'ref';

      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(api.searchItems('test')).rejects.toThrow('Oturum süresi doldu');
    });

    it('deduplicates concurrent refresh requests (mutex)', async () => {
      storageData['ironstock_server_url'] = 'https://vault.test';
      storageData['ironstock_access_token'] = 'old-tok';
      storageData['ironstock_refresh_token'] = 'ref';

      let refreshCallCount = 0;
      fetchMock.mockImplementation((url, opts) => {
        if (url.includes('/auth/refresh')) {
          refreshCallCount++;
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              access_token: 'new-tok',
              refresh_token: 'new-ref',
            }),
          });
        }
        if (opts?.headers?.Authorization === 'Bearer old-tok') {
          return Promise.resolve({ ok: false, status: 401 });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      const [r1, r2] = await Promise.all([
        api.searchItems('a'),
        api.searchItems('b'),
      ]);

      expect(refreshCallCount).toBe(1);
      expect(r1).toEqual([]);
      expect(r2).toEqual([]);
    });
  });
});
