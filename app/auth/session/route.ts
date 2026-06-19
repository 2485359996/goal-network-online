import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type LoginIntent = "login" | "signup" | "reset";

function loginRedirect(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/login", request.url);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return NextResponse.redirect(url, { status: 303 });
}

function normalizeEmail(formData: FormData) {
  return String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
}

function hasSupabasePublicEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

function authErrorCode(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "invalid_credentials";
  if (normalized.includes("email not confirmed")) return "email_not_confirmed";
  if (normalized.includes("already registered") || normalized.includes("already been registered")) return "email_already_registered";
  if (normalized.includes("password")) return "password_rejected";
  return "auth_failed";
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

function normalizeOrigin(value: string | undefined) {
  if (!value) return "";
  const candidate = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function forwardedOrigin(headerStore: Headers) {
  const host = firstHeaderValue(headerStore.get("x-forwarded-host")) || firstHeaderValue(headerStore.get("host"));
  if (!host) return "";
  const forwardedProto = firstHeaderValue(headerStore.get("x-forwarded-proto"));
  const protocol = forwardedProto === "http" || host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

function getPasswordResetRedirectUrl(request: NextRequest) {
  const origin =
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeOrigin(process.env.VERCEL_URL) ||
    forwardedOrigin(request.headers) ||
    request.nextUrl.origin ||
    "http://127.0.0.1:3000";
  return `${origin}/auth/confirm?next=/auth/update-password`;
}

function normalizeIntent(formData: FormData): LoginIntent {
  const intent = String(formData.get("intent") ?? "login");
  return intent === "signup" || intent === "reset" ? intent : "login";
}

function createSuccessResponse(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

function createAuthClient(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public env is not configured");

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
      }
    }
  });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = normalizeEmail(formData);
  const intent = normalizeIntent(formData);

  if (!hasSupabasePublicEnv()) {
    return loginRedirect(request, { error: "config_missing", email });
  }

  if (intent === "reset") {
    if (!email) return loginRedirect(request, { error: "email_required" });
    const response = loginRedirect(request, { status: "reset_email_sent", email });
    const supabase = createAuthClient(request, response);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(request)
    });
    return error ? loginRedirect(request, { error: "reset_failed", email }) : response;
  }

  const password = String(formData.get("password") ?? "");
  const response = createSuccessResponse(request);
  const supabase = createAuthClient(request, response);
  const result =
    intent === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

  if (result.error) return loginRedirect(request, { error: authErrorCode(result.error.message), email });
  if (intent === "signup" && !result.data.session) return loginRedirect(request, { status: "signup_check_email", email });

  return response;
}
