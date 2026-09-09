import { test, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";

// Card workflow states, checklists, reactions and pins — the Fizzy features
// (Card::Closeable / Golden / NotNow / Multistep / Pinnable, Reaction) that
// were either missing outright or existed only as unused tables.
//
// Same serial-suite shape as kanban.spec.ts: one signed-in context shared
// across steps that deliberately build on each other.

test.describe.configure({ mode: "serial" });

const runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const email = `cardfeat-${runId}@example.com`;
const password = "Test1234!";

let context: BrowserContext;
let page: Page;
let boardUrl = "";
let cardUrl = "";

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

  await page.getByPlaceholder("New board name…").fill("Card Features Board");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]+$/);
  boardUrl = page.url();

  const todo = columnByName(page, "To do");
  await todo.getByPlaceholder("New card…").fill("Feature card");
  await todo.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("link", { name: "Feature card" })).toBeVisible();

  await page.getByRole("link", { name: "Feature card" }).click();
  await page.waitForURL(/\/cards\/[0-9a-f-]+$/);
  cardUrl = page.url();
});

test.afterAll(async () => {
  await context.close();
});

test("checklist: add steps, tick one off, delete one", async () => {
  await page.goto(cardUrl);

  await page.getByPlaceholder("New step…").fill("First step");
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.getByText("First step")).toBeVisible();

  await page.getByPlaceholder("New step…").fill("Second step");
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.getByText("Second step")).toBeVisible();
  await expect(page.getByText("(0/2 done)")).toBeVisible();

  await page.getByLabel('Toggle step "First step"').click();
  await expect(page.getByText("(1/2 done)")).toBeVisible();

  await page.getByLabel('Delete step "Second step"').click();
  await expect(page.getByText("Second step")).toBeHidden();
  await expect(page.getByText("(1/1 done)")).toBeVisible();
});

test("golden: marking a card golden shows a star on the board", async () => {
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "☆ Mark golden" }).click();
  await expect(page.getByRole("button", { name: "⭐ Golden" })).toBeVisible();

  await page.goto(boardUrl);
  const cardRow = page.locator('[data-testid^="card-"]').filter({ hasText: "Feature card" });
  await expect(cardRow.getByTitle("Golden card")).toBeVisible();
});

test("pin: pinning a card shows a pin marker on the board", async () => {
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "📌 Pin" }).click();
  await expect(page.getByRole("button", { name: "📌 Pinned" })).toBeVisible();

  await page.goto(boardUrl);
  const cardRow = page.locator('[data-testid^="card-"]').filter({ hasText: "Feature card" });
  await expect(cardRow.getByTitle("Pinned")).toBeVisible();
});

test("watch: toggling watch reflects its current state", async () => {
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "👁 Watch" }).click();
  await expect(page.getByRole("button", { name: "👁 Watching" })).toBeVisible();
});

test("reactions: reacting to a comment records it and shows a count", async () => {
  await page.goto(cardUrl);
  await page.getByPlaceholder("Write a comment… (@name to mention)").fill("Reactable comment");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Reactable comment")).toBeVisible();

  await page.getByRole("button", { name: "React 🎉" }).first().click();
  await expect(page.getByRole("button", { name: "React 🎉" }).first()).toContainText("1");
});

test("postpone: a postponed card drops off the board until revealed", async () => {
  await page.goto(cardUrl);
  await page.getByLabel("Postpone this card").selectOption("7");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Postponed until/)).toBeVisible();

  await page.goto(boardUrl);
  await expect(page.getByRole("link", { name: "Feature card" })).toBeHidden();

  await page.getByRole("link", { name: /Show postponed/ }).click();
  await expect(page.getByRole("link", { name: "Feature card" })).toBeVisible();

  // Resume it so the closing test below starts from a visible card.
  await page.goto(cardUrl);
  await page.getByLabel("Postpone this card").selectOption("resume");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Postponed until/)).toBeHidden();
});

test("close: a closed card is struck through and hidden from the board", async () => {
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "Close card" }).click();
  await expect(page.getByRole("button", { name: "Reopen card" })).toBeVisible();

  await page.goto(boardUrl);
  await expect(page.getByRole("link", { name: "Feature card" })).toBeHidden();

  await page.getByRole("link", { name: /Show closed/ }).click();
  await expect(page.getByRole("link", { name: "Feature card" })).toBeVisible();
});

test("triage: an untriaged card appears in triage and can be kept", async () => {
  await page.goto(boardUrl);
  const todo = columnByName(page, "To do");
  await todo.getByPlaceholder("New card…").fill("Needs triage");
  await todo.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("link", { name: "Needs triage" })).toBeVisible();

  await page.getByRole("link", { name: /^Triage/ }).click();
  await page.waitForURL(/\/triage$/);
  await expect(page.getByRole("link", { name: "Needs triage" })).toBeVisible();

  const triageRow = page
    .locator('[data-testid^="triage-"]')
    .filter({ hasText: "Needs triage" });
  await triageRow.getByRole("button", { name: "Keep" }).click();

  await expect(
    page.locator('[data-testid^="triage-"]').filter({ hasText: "Needs triage" }),
  ).toHaveCount(0);
});
