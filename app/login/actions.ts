"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../src/lib/supabase/server";

function loginRedirect(params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  redirect(`/login?${searchParams.toString()}`);
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

function forwardedOrigin(headerStore: { get(name: string): string | null }) {
  const host = firstHeaderValue(headerStore.get("x-forwarded-host")) || firstHeaderValue(headerStore.get("host"));
  if (!host) return "";
  const forwardedProto = firstHeaderValue(headerStore.get("x-forwarded-proto"));
  const protocol = forwardedProto === "http" || host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

async function getPasswordResetRedirectUrl() {
  const headerStore = await headers();
  const origin =
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeOrigin(process.env.VERCEL_URL) ||
    forwardedOrigin(headerStore) ||
    "http://127.0.0.1:3000";
  return `${origin}/auth/confirm?next=/auth/update-password`;
}

async function authAction(formData: FormData, mode: "login" | "signup") {
  const email = normalizeEmail(formData);
  const password = String(formData.get("password") ?? "");
  if (!hasSupabasePublicEnv()) {
    loginRedirect({ error: "config_missing", email });
  }
  const supabase = await createServerSupabaseClient();
  const result =
    mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
  if (result.error) loginRedirect({ error: authErrorCode(result.error.message), email });
  if (mode === "signup" && !result.data.session) {
    loginRedirect({ status: "signup_check_email", email });
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function login(formData: FormData) {
  await authAction(formData, "login");
}

export async function signup(formData: FormData) {
  await authAction(formData, "signup");
}

export async function requestPasswordReset(formData: FormData) {
  const email = normalizeEmail(formData);
  if (!hasSupabasePublicEnv()) {
    loginRedirect({ error: "config_missing", email });
  }
  if (!email) {
    loginRedirect({ error: "email_required" });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: await getPasswordResetRedirectUrl()
  });
  if (error) {
    loginRedirect({ error: "reset_failed", email });
  }
  loginRedirect({ status: "reset_email_sent", email });
}
