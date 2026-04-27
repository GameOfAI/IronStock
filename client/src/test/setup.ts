import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useAuthStore } from '@/store/auth';

afterEach(() => {
  cleanup();
  useAuthStore.getState().clear();
  useAuthStore.setState({ hydrating: false });
});
