// IronStock Browser Extension — Content Script
// Login formlarını tespit eder ve credential doldurma UI'ı gösterir.

(function () {
  'use strict';

  let autofillOverlay = null;

  function findLoginForms() {
    const forms = [];
    const inputs = document.querySelectorAll('input[type="password"]');

    for (const passwordInput of inputs) {
      const form = passwordInput.closest('form') || passwordInput.parentElement;
      const usernameInput = form?.querySelector(
        'input[type="text"], input[type="email"], input[name*="user"], input[name*="login"], input[name*="email"], input[autocomplete="username"]'
      );

      if (usernameInput) {
        forms.push({ form, usernameInput, passwordInput });
      }
    }

    return forms;
  }

  function fillCredentials(usernameInput, passwordInput, username, password) {
    setInputValue(usernameInput, username);
    setInputValue(passwordInput, password);
  }

  function setInputValue(input, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createOverlay(items, usernameInput, passwordInput) {
    removeOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'ironstock-autofill-overlay';
    overlay.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #1e293b; color: #e2e8f0; border: 1px solid #334155;
      border-radius: 12px; padding: 16px; z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px; min-width: 320px; max-height: 400px;
      overflow-y: auto; box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
    header.innerHTML = `
      <span style="font-weight:600;font-size:15px;">IronStock</span>
      <button id="ironstock-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;">&times;</button>
    `;
    overlay.appendChild(header);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#94a3b8;text-align:center;padding:20px;';
      empty.textContent = 'Bu site için credential bulunamadı';
      overlay.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = `
          padding: 10px 12px; border-radius: 8px; cursor: pointer;
          margin-bottom: 4px; transition: background 0.15s;
        `;
        row.addEventListener('mouseenter', () => { row.style.background = '#334155'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

        row.innerHTML = `
          <div style="font-weight:500;">${escapeHtml(item.name)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(item.folder_name || '')}</div>
        `;

        row.addEventListener('click', async () => {
          try {
            const resp = await chrome.runtime.sendMessage({
              type: 'IRONSTOCK_GET_ITEM',
              id: item.id,
            });
            if (resp.item) {
              const fields = resp.item.fields || [];
              const username = findFieldValue(fields, ['username', 'user', 'email', 'login']);
              const password = findFieldValue(fields, ['password', 'pass', 'secret', 'key']);

              if (username && password && usernameInput && passwordInput) {
                fillCredentials(usernameInput, passwordInput, username, password);
              }
            }
            removeOverlay();
          } catch (err) {
            console.error('IronStock autofill hatası:', err);
          }
        });

        overlay.appendChild(row);
      }
    }

    document.body.appendChild(overlay);
    autofillOverlay = overlay;

    overlay.querySelector('#ironstock-close')?.addEventListener('click', removeOverlay);
    document.addEventListener('keydown', handleEscape);
  }

  function handleEscape(e) {
    if (e.key === 'Escape') removeOverlay();
  }

  function removeOverlay() {
    if (autofillOverlay) {
      autofillOverlay.remove();
      autofillOverlay = null;
      document.removeEventListener('keydown', handleEscape);
    }
  }

  function findFieldValue(fields, keywords) {
    for (const field of fields) {
      const name = (field.field_name || field.name || '').toLowerCase();
      if (keywords.some((kw) => name.includes(kw))) {
        return field.value || field.decrypted_value || '';
      }
    }
    return '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Mesaj Dinleyici ---

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'IRONSTOCK_SHOW_AUTOFILL') {
      const forms = findLoginForms();
      const hostname = window.location.hostname;

      chrome.runtime.sendMessage(
        { type: 'IRONSTOCK_SEARCH', query: hostname },
        (resp) => {
          if (resp?.results) {
            const form = forms[0];
            createOverlay(
              resp.results,
              form?.usernameInput || null,
              form?.passwordInput || null
            );
          }
        }
      );
    }

    if (message.type === 'IRONSTOCK_SEARCH_RESULTS') {
      const forms = findLoginForms();
      const form = forms[0];
      createOverlay(
        message.results || [],
        form?.usernameInput || null,
        form?.passwordInput || null
      );
    }
  });
})();
