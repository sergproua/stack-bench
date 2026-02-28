import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeBasePath = (value?: string): string => {
  const raw = value?.trim();
  if (!raw || raw === '/') {
    return '/';
  }

  const withLeadingSlash = raw.charAt(0) === '/' ? raw : `/${raw}`;
  return withLeadingSlash.slice(-1) === '/' ? withLeadingSlash : `${withLeadingSlash}/`;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const base = normalizeBasePath(env.VITE_BASE_PATH);

  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
