"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../src/lib/supabase/server";

async function authAction(formData: FormData, mode: "login" | "signup") {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createServerSupabaseClient();
  const result =
    mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
  if (result.error) redirect(`/error?message=${encodeURIComponent(result.error.message)}`);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function login(formData: FormData) {
  await authAction(formData, "login");
}

export async function signup(formData: FormData) {
  await authAction(formData, "signup");
}
