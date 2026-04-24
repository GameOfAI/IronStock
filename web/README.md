# Envanter — Admin Web UI

React + Vite + TypeScript ile yazılmış admin paneli.

## Geliştirme

Gereksinimler: Node 20+

```bash
npm install
npm run dev        # http://localhost:5173
```

Dev server `localhost:8080` adresindeki Go API'ye `/api` ve `/ws` üzerinden proxy yapar.

## Scripts

| Komut | Ne yapar |
|-------|----------|
| `npm run dev` | Vite dev server (HMR) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Production build'i test et |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Vitest |

## Durum

**Faz 0 iskeleti.** Gerçek UI Faz 3'te:
- Login + MFA
- User/role yönetimi
- Envanter ağaç + tablo view
- Item edit formu
