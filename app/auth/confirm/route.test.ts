import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn()
}));

vi.mock("../../../src/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      verifyOtp: mocks.verifyOtp
    }
  }))
}));

async function getConfirm(url: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(url));
}

describe("auth confirmation redirect handling", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.verifyOtp.mockReset();
    mocks.verifyOtp.mockResolvedValue({ error: null });
  });

  it("keeps encoded backslash next redirects on the app origin", async () => {
    const response = await getConfirm("https://app.example/auth/confirm?token_hash=t&type=email&next=/%5Cevil.example/path");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/");
  });

  it("allows ordinary same-origin paths after OTP verification", async () => {
    const response = await getConfirm("https://app.example/auth/confirm?token_hash=t&type=email&next=/auth/update-password?from=email");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/auth/update-password?from=email");
  });
});
