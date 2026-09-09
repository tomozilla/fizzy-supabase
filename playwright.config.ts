import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Load .env.test.local ourselves (rather than relying on Next's env-file
// precedence rules, which are easy to get subtly wrong) and pass the values
// as real process env vars to the dev server Playwright spawns — those
// always win over whatever `.env.local` (the cloud project) declares.
const testEnvPath = path.resolve(__dirname, ".env.test.local");
const testEnv: Record<string, string> = {};
for (const line of fs.readFileSync(testEnvPath, "utf-8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) testEnv[match[1]] = match[2];
}

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // The dev server compiles each route on first hit, so a test that walks
  // through several not-yet-compiled pages (the invite flow crosses five)
  // can blow the 30s default before doing anything actually slow.
  timeout: 90_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: testEnv,
  },
});
