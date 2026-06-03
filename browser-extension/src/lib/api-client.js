// IronStock API istemcisi — browser extension için.

const STORAGE_KEYS = {
  SERVER_URL: 'ironstock_server_url',
  ACCESS_TOKEN: 'ironstock_access_token',
  REFRESH_TOKEN: 'ironstock_refresh_token',
};

export async function getConfig() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.SERVER_URL,
    STORAGE_KEYS.ACCESS_TOKEN,
    STORAGE_KEYS.REFRESH_TOKEN,
  ]);
  return {
    serverUrl: result[STORAGE_KEYS.SERVER_URL] || '',
    accessToken: result[STORAGE_KEYS.ACCESS_TOKEN] || '',
    refreshToken: result[STORAGE_KEYS.REFRESH_TOKEN] || '',
  };
}

export async function saveConfig(config) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SERVER_URL]: config.serverUrl,
    [STORAGE_KEYS.ACCESS_TOKEN]: config.accessToken,
    [STORAGE_KEYS.REFRESH_TOKEN]: config.refreshToken,
  });
}

export async function clearConfig() {
  await chrome.storage.local.remove(Object.values(STORAGE_KEYS));
}

let _refreshPromise = null;

async function refreshTokens(config) {
  const refreshResp = await fetch(`${config.serverUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: config.refreshToken }),
  });

  if (!refreshResp.ok) {
    await clearConfig();
    throw new Error('Oturum süresi doldu — yeniden giriş yapın');
  }

  const tokens = await refreshResp.json();
  const newConfig = {
    ...config,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || config.refreshToken,
  };
  await saveConfig(newConfig);
  return newConfig;
}

async function apiRequest(method, path, body = null) {
  const config = await getConfig();
  if (!config.serverUrl || !config.accessToken) {
    throw new Error('IronStock yapılandırılmamış');
  }

  const url = `${config.serverUrl}${path}`;
  const headers = {
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json',
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  let resp = await fetch(url, options);

  // Token süresi dolmuşsa yenile (mutex ile eşzamanlı refresh'leri engelle)
  if (resp.status === 401 && config.refreshToken) {
    if (!_refreshPromise) {
      _refreshPromise = refreshTokens(config).finally(() => { _refreshPromise = null; });
    }

    try {
      const newConfig = await _refreshPromise;
      headers['Authorization'] = `Bearer ${newConfig.accessToken}`;
      resp = await fetch(url, { method, headers, body: options.body });
    } catch (err) {
      throw err;
    }
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API hatası (${resp.status}): ${text}`);
  }

  return resp.json();
}

export async function login(serverUrl, username, password, totpCode = null) {
  const body = { username, password };
  if (totpCode) {
    body.totp_code = totpCode;
  }

  const resp = await fetch(`${serverUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Giriş başarısız (${resp.status}): ${text}`);
  }

  const data = await resp.json();

  if (data.totp_required) {
    return { totpRequired: true };
  }

  await saveConfig({
    serverUrl,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });

  return { success: true };
}

export async function logout() {
  try {
    await apiRequest('POST', '/api/v1/auth/logout');
  } catch {
    // Logout hatası kritik değil
  }
  await clearConfig();
}

export async function searchItems(query) {
  return apiRequest('GET', `/api/v1/items/search?q=${encodeURIComponent(query)}`);
}

export async function getItem(id) {
  return apiRequest('GET', `/api/v1/items/${id}`);
}

export async function listFolders() {
  return apiRequest('GET', '/api/v1/folders');
}

export async function listFolderItems(folderId) {
  return apiRequest('GET', `/api/v1/folders/${folderId}/items`);
}

export async function isAuthenticated() {
  const config = await getConfig();
  return !!(config.serverUrl && config.accessToken);
}
