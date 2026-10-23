import { defineConfig } from "@playwright/test";

// Isolated UI regressions: no login fixture, backend or database is required.
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["global-payroll-countries.spec.ts", "global-employee-bulk.spec.ts"],
  timeout: 15000,
  retries: 0,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5175", headless: true, browserName: "chromium" },
  webServer: {
    command: "npm exec -- vite --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
