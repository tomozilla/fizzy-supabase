import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Import (round-tripping an export), saved searches, and activity-spike
// detection — Fizzy's Account::Import, Filter, and
// Card::ActivitySpike::Detector.

test.describe.configure({ mode: "serial" });

const runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const email = `data-${runId}@example.com`;
const password = "Test1234!";

let context: BrowserContext;
let page: Page;
let boardUrl = "";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();

  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/boards");

  await page.getByPlaceholder("New board name…").fill("Data Board");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+$/);
  boardUrl = page.url();

  const todo = page
    .locator('[data-testid^="column-"]')
    .filter({ has: page.getByRole("heading", { name: "To do", exact: true }) });
  await todo.getByPlaceholder("New card…").fill("Original card");
  await todo.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("link", { name: "Original card" })).toBeVisible();
});

test.afterAll(async () => {
  await context.close();
});

test("import: re-importing an export duplicates the board rather than clobbering it", async () => {
  const exported = await (await page.request.get("/api/export")).text();

  await page.goto("/settings");
  // Settings streams in via Suspense — wait for the importer to actually be
  // there before driving it, rather than racing the stream.
  const importer = page.getByLabel("Import workspace JSON");
  await expect(importer).toBeVisible();
  await importer.setInputFiles({
    name: "export.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported),
  });

  await expect(page.getByTestId("import-status")).toContainText(/Imported 1 board/);

  await page.goto("/boards");
  await expect(page.getByRole("link", { name: "Data Board" })).toHaveCount(2);
});

test("import: rejects a file that isn't an export", async () => {
  await page.goto("/settings");
  const badImporter = page.getByLabel("Import workspace JSON");
  await expect(badImporter).toBeVisible();
  await badImporter.setInputFiles({
    name: "nope.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ hello: "world" })),
  });

  await expect(page.getByTestId("import-status")).toContainText(/doesn't look like/);
});

test("saved searches: a search can be saved, reused and deleted", async () => {
  await page.goto("/search");
  await page.getByLabel("Search cards and comments").fill("original");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("link", { name: "Original card", exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel("Name for this saved search").fill("Originals");
  await page.getByRole("button", { name: "Save search" }).click();

  const saved = page.locator('[data-testid^="filter-"]').filter({ hasText: "Originals" });
  await expect(saved).toBeVisible();

  // Reusing it re-runs the same query.
  await page.goto("/search");
  await page.getByRole("link", { name: "Originals" }).click();
  await expect(page).toHaveURL(/q=original/);
  await expect(
    page.getByRole("link", { name: "Original card", exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel('Delete saved search "Originals"').click();
  await expect(
    page.locator('[data-testid^="filter-"]').filter({ hasText: "Originals" }),
  ).toHaveCount(0);
});

test("activity spike: a busy card gets flagged on the board", async () => {
  await page.goto(boardUrl);
  await page.getByRole("link", { name: "Original card" }).first().click();
  await page.waitForURL(/\/cards\/[0-9a-f-]+$/);

  // Five events in the window is the threshold; each of these writes one.
  for (const label of ["👁 Watch", "☆ Mark golden", "⭐ Golden", "☆ Mark golden"]) {
    await page.getByRole("button", { name: label }).click();
    await page.waitForTimeout(150);
  }
  for (const body of ["one", "two", "three"]) {
    await page.getByPlaceholder("Write a comment… (@name to mention)").fill(body);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
  }

  await page.goto(boardUrl);
  const cardRow = page.locator('[data-testid^="card-"]').filter({ hasText: "Original card" });
  await expect(cardRow.getByTitle("Unusual recent activity")).toBeVisible();
});
