import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase/server";

const SAME_ORIGIN_BASE = "https://goal-network.local";

export function safeNextPath(value: string | null) {
  const nextPath = value?.trim();
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//") || nextPath.includes("\\")) return "/";
  try {
    const parsed = new URL(nextPath, SAME_ORIGIN_BASE);
    if (parsed.origin !== SAME_ORIGIN_BASE) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const redirectTo = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.nextUrl.origin);

  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/error";
  redirectTo.searchParams.set("message", "Auth confirmation failed");
  return NextResponse.redirect(redirectTo);
}
