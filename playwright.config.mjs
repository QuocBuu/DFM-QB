import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 20000,
  use: {
    baseURL: 'http://127.0.0.1:8097',
    browserName: 'chromium',
    launchOptions: process.env.UI_BROWSER_PATH ? {executablePath: process.env.UI_BROWSER_PATH} : {},
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 8097 --bind 127.0.0.1 --directory dist',
    url: 'http://127.0.0.1:8097',
    reuseExistingServer: false
  }
});
