// IronStock Browser Extension — Background Service Worker
// Context menu ve mesaj yönetimi.

import { searchItems, getItem, isAuthenticated } from '../lib/api-client.js';

// --- Context Menu ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ironstock-autofill',
    title: 'IronStock ile Doldur',
    contexts: ['editable'],
  });

  chrome.contextMenus.create({
    id: 'ironstock-search',
    title: 'IronStock\'ta Ara: "%s"',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const authed = await isAuthenticated();
  if (!authed) {
    chrome.action.openPopup();
    return;
  }

  if (info.menuItemId === 'ironstock-autofill') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'IRONSTOCK_SHOW_AUTOFILL',
    });
  }

  if (info.menuItemId === 'ironstock-search') {
    const query = info.selectionText?.trim();
    if (query) {
      try {
        const results = await searchItems(query);
        chrome.tabs.sendMessage(tab.id, {
          type: 'IRONSTOCK_SEARCH_RESULTS',
          results: results.slice(0, 10),
        });
      } catch (err) {
        console.error('IronStock arama hatası:', err);
      }
    }
  }
});

// --- Mesaj Yönetimi ---

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'IRONSTOCK_SEARCH') {
    searchItems(message.query)
      .then((results) => sendResponse({ results }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (message.type === 'IRONSTOCK_GET_ITEM') {
    getItem(message.id)
      .then((item) => sendResponse({ item }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'IRONSTOCK_CHECK_AUTH') {
    isAuthenticated()
      .then((authed) => sendResponse({ authenticated: authed }))
      .catch(() => sendResponse({ authenticated: false }));
    return true;
  }
});

// --- Keyboard Shortcut ---

chrome.commands?.onCommand?.addListener((command) => {
  if (command === 'open-popup') {
    chrome.action.openPopup();
  }
});
