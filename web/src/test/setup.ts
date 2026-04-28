import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useAuthStore } from '@/store/auth';

// jsdom 25 + vitest 2: localStorage may not initialise correctly in workers.
// Provide a simple in-memory shim that satisfies the Storage interface.
const makeLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeLocalStorage(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  // Reset Zustand auth store so tests don't bleed into each other.
  useAuthStore.getState().clear();
  useAuthStore.setState({ hydrating: false });
});
