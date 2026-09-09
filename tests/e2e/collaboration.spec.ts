import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Team invites, the notification inbox, search, personal views, profile, and
// export — i.e. everything that only makes sense once more than one person
// (or more than one card) is involved.

test.describe.configure({ mode: "serial" });

const runId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const owner = { email: `owner-${runId}@example.com`, password: "Test1234!" };
const invitee = { email: `invitee-${runId}@example.com`, password: "Test1234!" };

let ownerContext: BrowserContext;
let ownerPage: Page;
let boardUrl = "";
let inviteCode = "";

async function signUp(page: Page, user: { email: string; password: string }) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Repeat Password").fill(user.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/(boards|join)/);
}

test.beforeAll(async ({ browser }) => {
  ownerContext = await browser.newContext();
  ownerPage = await ownerContext.newPage();
  await signUp(ownerPage, owner);

  await ownerPage.getByPlaceholder("New board name…").fill("Team Board");
  await ownerPage.getByRole("button", { name: "Create board" }).click();
  await ownerPage.waitForURL(/\/boards\/[0-9a-f-]+$/);
  boardUrl = ownerPage.url();

  const todo = ownerPage
    .locator('[data-testid^="column-"]')
    .filter({ has: ownerPage.getByRole("heading", { name: "To do", exact: true }) });
  await todo.getByPlaceholder("New card…").fill("Shared card about penguins");
  await todo.getByRole("button", { name: "Add card" }).click();
  await expect(ownerPage.getByRole("link", { name: "Shared card about penguins" })).toBeVisible();
});

test.afterAll(async () => {
  await ownerContext.close();
});

test("settings: profile name can be changed", async () => {
  await ownerPage.goto("/settings");
  await ownerPage.getByLabel("Your display name").fill("Board Owner");
  await ownerPage.getByRole("button", { name: "Save name" }).click();
  await expect(ownerPage.getByTestId(/^member-/).first()).toContainText("Board Owner");
});

test("settings: creating an invite link surfaces a join code", async () => {
  await ownerPage.goto("/settings");
  await ownerPage.getByRole("button", { name: "Create invite link" }).first().click();

  const link = ownerPage.getByTestId("invite-link").first();
  await expect(link).toBeVisible();
  const text = (await link.textContent()) ?? "";
  inviteCode = text.replace("/join/", "").trim();
  expect(inviteCode.length).toBeGreaterThan(8);
});

test("invite: a second user can redeem the code and see the shared board", async ({ browser }) => {
  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();

  // Landing on the invite while signed out should bounce through login and
  // come back — not silently dump the user on /boards and lose the invite.
  await inviteePage.goto(`/join/${inviteCode}`);
  await inviteePage.waitForURL(/\/auth\/login\?next=/);

  await inviteePage.getByRole("link", { name: "Sign up" }).click();
  // Wait for the actual navigation before filling: the login page has an
  // Email/Password field too, so Playwright would happily type into the page
  // we're leaving and submit an empty sign-up form.
  await inviteePage.waitForURL(/\/auth\/sign-up/);
  await inviteePage.getByLabel("Email").fill(invitee.email);
  await inviteePage.getByLabel("Password", { exact: true }).fill(invitee.password);
  await inviteePage.getByLabel("Repeat Password").fill(invitee.password);
  await inviteePage.getByRole("button", { name: "Sign up" }).click();
  await inviteePage.waitForURL(new RegExp(`/join/${inviteCode}`));

  await inviteePage.getByRole("button", { name: "Accept invite" }).click();
  await inviteePage.waitForURL("**/boards");

  // The shared board is now visible to the invitee under RLS.
  await expect(inviteePage.getByText("Team Board")).toBeVisible();
  await inviteePage.goto(boardUrl);
  await expect(inviteePage.getByRole("link", { name: "Shared card about penguins" })).toBeVisible();

  await inviteeContext.close();
});

test("invite: an invalid code does not join anything", async ({ browser }) => {
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();

  await signUp(strangerPage, {
    email: `stranger-${runId}@example.com`,
    password: "Test1234!",
  });

  await strangerPage.goto("/join/totally-made-up-code");
  await strangerPage.getByRole("button", { name: "Accept invite" }).click();
  await strangerPage.waitForURL(/invalid=1/);

  // Still only in their own workspace — the shared board stays invisible.
  await strangerPage.goto("/boards");
  await expect(strangerPage.getByText("Team Board")).toBeHidden();

  await strangerContext.close();
});

test("notifications: watching a card produces an inbox entry for activity", async ({ browser }) => {
  // Owner watches the card; the invitee comments on it; owner gets notified.
  await ownerPage.goto(boardUrl);
  await ownerPage.getByRole("link", { name: "Shared card about penguins" }).click();
  await ownerPage.waitForURL(/\/cards\/[0-9a-f-]+$/);
  const cardUrl = ownerPage.url();
  await ownerPage.getByRole("button", { name: "👁 Watch" }).click();
  await expect(ownerPage.getByRole("button", { name: "👁 Watching" })).toBeVisible();

  const inviteeContext = await browser.newContext();
  const inviteePage = await inviteeContext.newPage();
  await inviteePage.goto("/auth/login");
  await inviteePage.getByLabel("Email").fill(invitee.email);
  await inviteePage.getByLabel("Password", { exact: true }).fill(invitee.password);
  await inviteePage.getByRole("button", { name: "Login" }).click();
  await inviteePage.waitForURL("**/boards");

  await inviteePage.goto(cardUrl);
  await inviteePage
    .getByPlaceholder("Write a comment… (@name to mention)")
    .fill("Penguins are excellent");
  await inviteePage.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(inviteePage.getByText("Penguins are excellent")).toBeVisible();
  await inviteeContext.close();

  await ownerPage.goto("/notifications");
  await expect(ownerPage.getByText(/commented on/)).toBeVisible();

  await ownerPage.getByRole("button", { name: "Mark all read" }).click();
  await expect(ownerPage.getByText("All caught up.")).toBeVisible();
});

test("search: full-text search finds a card and a comment", async () => {
  await ownerPage.goto("/search");
  await ownerPage.getByLabel("Search cards and comments").fill("penguins");
  await ownerPage.getByRole("button", { name: "Search" }).click();

  await expect(
    ownerPage.getByRole("link", { name: "Shared card about penguins", exact: true }),
  ).toBeVisible();
  await expect(ownerPage.getByText(/Penguins are excellent/)).toBeVisible();
});

test("my stuff: watched card shows up in the personal view", async () => {
  await ownerPage.goto("/my");
  await expect(ownerPage.getByRole("link", { name: /Shared card about penguins/ })).toBeVisible();
});

test("export: downloads a JSON snapshot of the workspace", async () => {
  const response = await ownerPage.request.get("/api/export");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.format_version).toBe(1);
  expect(body.boards.some((b: { name: string }) => b.name === "Team Board")).toBe(true);
  expect(
    body.cards.some((c: { title: string }) => c.title === "Shared card about penguins"),
  ).toBe(true);
});

test("webhooks: can be registered and removed in settings", async () => {
  await ownerPage.goto("/settings");
  await ownerPage.getByLabel(/^Webhook URL for/).first().fill("https://example.com/hook");
  await ownerPage.getByRole("button", { name: "Add webhook" }).first().click();
  await expect(ownerPage.getByText("https://example.com/hook")).toBeVisible();

  await ownerPage
    .locator('[data-testid^="webhook-"]')
    .filter({ hasText: "https://example.com/hook" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(ownerPage.getByText("No webhooks configured.")).toBeVisible();
});
