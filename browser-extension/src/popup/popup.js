import { login, logout, searchItems, isAuthenticated, getConfig } from '../lib/api-client.js';

const loginView = document.getElementById('login-view');
const vaultView = document.getElementById('vault-view');
const footer = document.getElementById('footer');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');
const searchInput = document.getElementById('search');
const itemList = document.getElementById('item-list');
const totpField = document.getElementById('totp-field');

let searchTimeout = null;

async function init() {
  const authed = await isAuthenticated();
  if (authed) {
    showVault();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginView.style.display = 'block';
  vaultView.style.display = 'none';
  footer.style.display = 'none';
}

function showVault() {
  loginView.style.display = 'none';
  vaultView.style.display = 'block';
  footer.style.display = 'flex';
  searchInput.focus();
}

loginBtn.addEventListener('click', async () => {
  const serverUrl = document.getElementById('server-url').value.trim().replace(/\/$/, '');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const totp = document.getElementById('totp').value.trim();

  if (!serverUrl || !username || !password) {
    loginError.textContent = 'Tüm alanları doldurun';
    return;
  }

  loginBtn.disabled = true;
  loginError.textContent = '';

  try {
    const result = await login(serverUrl, username, password, totp || null);

    if (result.totpRequired) {
      totpField.style.display = 'block';
      document.getElementById('totp').focus();
      loginError.textContent = 'TOTP kodu gerekli';
    } else if (result.success) {
      showVault();
    }
  } catch (err) {
    loginError.textContent = err.message;
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await logout();
  showLogin();
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();

  if (query.length < 2) {
    itemList.innerHTML = '<div class="empty">En az 2 karakter girin</div>';
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const results = await searchItems(query);
      renderItems(results);
    } catch (err) {
      itemList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }, 300);
});

function renderItems(items) {
  if (!items || items.length === 0) {
    itemList.innerHTML = '<div class="empty">Sonuç bulunamadı</div>';
    return;
  }

  itemList.innerHTML = '';
  for (const item of items.slice(0, 20)) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-folder">${escapeHtml(item.folder_name || '')}</div>
    `;
    div.addEventListener('click', () => handleItemClick(item));
    itemList.appendChild(div);
  }
}

async function handleItemClick(item) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'IRONSTOCK_SHOW_AUTOFILL',
      });

      const resp = await chrome.runtime.sendMessage({
        type: 'IRONSTOCK_GET_ITEM',
        id: item.id,
      });

      if (resp?.item) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'IRONSTOCK_SEARCH_RESULTS',
          results: [resp.item],
        });
      }
    }
    window.close();
  } catch (err) {
    console.error('Item tıklama hatası:', err);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Enter tuşu ile giriş
document.querySelectorAll('#login-view input').forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });
});

init();
