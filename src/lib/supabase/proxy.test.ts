import { describe, expect, it } from "vitest";
import { shouldRedirectUnauthenticatedRequest } from "./proxy";

describe("Supabase proxy auth redirects", () => {
  it("redirects protected page requests when there is no authenticated user", () => {
    expect(shouldRedirectUnauthenticatedRequest("/")).toBe(true);
    expect(shouldRedirectUnauthenticatedRequest("/goals")).toBe(true);
  });

  it("keeps public auth and API routes from redirecting to the login page", () => {
    expect(shouldRedirectUnauthenticatedRequest("/login")).toBe(false);
    expect(shouldRedirectUnauthenticatedRequest("/auth/confirm")).toBe(false);
    expect(shouldRedirectUnauthenticatedRequest("/auth/update-password")).toBe(false);
    expect(shouldRedirectUnauthenticatedRequest("/api/goals")).toBe(false);
    expect(shouldRedirectUnauthenticatedRequest("/api/cron/drain-jobs")).toBe(false);
  });
});
