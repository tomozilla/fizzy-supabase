import { test, expect, type Page } from "@playwright/test";

// Passkeys, driven against Chromium's virtual authenticator (CDP WebAuthn
// domain) so the whole WebAuthn ceremony runs for real without any hardware
// or user gesture. Fizzy hand-rolls this in Passkey::Authenticator; here
// Supabase Auth performs registration and assertion, and this test proves
// the round trip: register a passkey, sign out, sign back in with it.

async function installVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

test("passkeys: register one, then sign in with it", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installVirtualAuthenticator(page);

  const email = `passkey-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
  const password = "Test1234!";

  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/boards");

  // ── Register ──────────────────────────────────────────────────────────
  await page.goto("/settings");
  const addButton = page.getByRole("button", { name: "Add a passkey" });
  await expect(addButton).toBeVisible();
  await addButton.click();

  await expect(page.getByTestId("passkey-status")).toHaveText(/Passkey registered/, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid^="passkey-"]').first()).toBeVisible();

  // ── Sign out, then sign back in using only the passkey ────────────────
  await page.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL(/\/(auth\/login)?$/);

  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForURL("**/boards", { timeout: 20_000 });
  await expect(page.getByText(/'s Workspace/)).toBeVisible();

  await context.close();
});
