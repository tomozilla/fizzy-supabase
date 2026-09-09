// Pure, framework-free logic pulled out of app/actions.ts so it can be unit
// tested without a database — the RLS-dependent parts stay in actions.ts and
// are covered by Playwright e2e + pgTAP instead (see docs/testing.md).

/** Next fractional position for an item appended to the end of an ordered list. */
export function nextPosition(items: { position: number }[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((i) => i.position)) + 1;
}

/** Turn a display name into a URL/identifier-safe slug, suffixed for uniqueness. */
export function slugify(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "workspace"}-${suffix}`;
}

/** Extract distinct lowercased @handles from a comment body, e.g. "hi @Ada" -> ["ada"]. */
export function parseMentionHandles(body: string): string[] {
  const handles = Array.from(body.matchAll(/@(\w+)/g)).map((m) => m[1].toLowerCase());
  return Array.from(new Set(handles));
}

/** Does an account member's full name match a parsed @handle (case/space-insensitive)? */
export function nameMatchesHandle(fullName: string | null | undefined, handle: string): boolean {
  if (!fullName) return false;
  return fullName.toLowerCase().replace(/\s+/g, "") === handle;
}
