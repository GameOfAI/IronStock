import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useAuthStore } from '@/store/auth';

afterEach(() => {
  cleanup();
  // Reset Zustand auth store so tests don't bleed into each other.
  useAuthStore.getState().clear();
  useAuthStore.setState({ hydrating: false });
});
