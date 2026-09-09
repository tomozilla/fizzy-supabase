import { test, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";

// Runs against the LOCAL Supabase stack only (see playwright.config.ts +
// .env.test.local) — never the cloud project. Run `supabase start` first.
//
// A single signed-in context is shared across this whole serial suite (the
// steps build on each other: sign up -> create a board -> add a card -> ...),
// which is why `page` comes from module state rather than the `{ page }`
// fixture — each `test()` gets an isolated context by default, and these
// steps are deliberately not isolated from one another.

test.describe.configure({ mode: "serial" });

const runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const email = `e2e-${runId}@example.com`;
const password = "Test1234!";

let context: BrowserContext;
let page: Page;
let boardUrl = "";

function columnByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid^="column-"]')
    .filter({ has: p.getByRole("heading", { name, exact: true }) });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();

  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/boards");
});

test.afterAll(async () => {
  await context.close();
});

test("sign up lands on /boards with a personal workspace", async () => {
  await expect(page.getByText("Workspace")).toBeVisible();
});

test("create a board seeds the three default columns", async () => {
  await page.goto("/boards");
  await page.getByPlaceholder("New board name…").fill("E2E Test Board");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+$/);
  boardUrl = page.url();

  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
});

test("create a card and move it to another column", async () => {
  await page.goto(boardUrl);

  const todoColumn = columnByName(page, "To do");
  await todoColumn.getByPlaceholder("New card…").fill("My first card");
  await todoColumn.getByRole("button", { name: "Add card" }).click();

  await expect(page.getByRole("link", { name: "My first card" })).toBeVisible();

  const cardRow = page.locator('[data-testid^="card-"]').filter({ hasText: "My first card" });
  await cardRow.locator("select").selectOption({ label: "Move to: Done" });

  await expect(columnByName(page, "Done").getByText("My first card")).toBeVisible();
});

test("card detail: add a comment and a tag", async () => {
  await page.goto(boardUrl);
  await page.getByRole("link", { name: "My first card" }).click();
  await page.waitForURL(/\/cards\/[0-9a-f-]+$/);

  await page.getByPlaceholder("Write a comment… (@name to mention)").fill("Looks good to me");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Looks good to me")).toBeVisible();

  await page.getByPlaceholder("New tag…").fill("urgent");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("button", { name: "urgent" })).toBeVisible();
});

test("realtime: a card moved in one tab appears moved in another, same account", async ({
  browser,
}) => {
  // A second tab authenticated as the SAME account (shares context's cookies),
  // to prove postgres_changes actually pushes the update rather than the
  // first tab merely rendering its own optimistic state.
  const storageState = await context.storageState();
  const context2 = await browser.newContext({ storageState });
  const page2 = await context2.newPage();

  await page.goto(boardUrl);
  await page2.goto(boardUrl);

  const cardRow = page.locator('[data-testid^="card-"]').filter({ hasText: "My first card" });
  await cardRow.locator("select").selectOption({ label: "Move to: In progress" });

  await expect(
    columnByName(page2, "In progress").getByText("My first card"),
  ).toBeVisible({ timeout: 10_000 });

  await context2.close();
});
