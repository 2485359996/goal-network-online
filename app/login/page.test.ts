import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("login form submission", () => {
  it("posts to a stable route handler instead of deployment-scoped Server Actions", () => {
    const pageSource = source("app/login/page.tsx");
    const routeSource = source("app/auth/session/route.ts");

    expect(pageSource).toContain('action="/auth/session" method="post"');
    expect(pageSource).not.toContain("formAction");
    expect(pageSource).not.toContain("./actions");
    expect(pageSource).toContain('name="intent" value="login"');
    expect(pageSource).toContain('name="intent" value="signup"');
    expect(pageSource).toContain('name="intent" value="reset"');
    expect(routeSource).toContain("createServerClient");
    expect(routeSource).toContain("response.cookies.set");
  });
});
