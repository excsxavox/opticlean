import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'e2e', '.data');

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx src/infrastructure/http/server.ts',
      cwd: path.join(root, 'backend'),
      port: 3011,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: '3011',
        OPTICLEAN_DATA_DIR: dataDir,
        OPTICLEAN_AUTH_DATA_DIR: dataDir,
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort --host 127.0.0.1',
      cwd: path.join(root, 'frontend'),
      port: 5174,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_PROXY: 'http://127.0.0.1:3011',
      },
    },
  ],
});
