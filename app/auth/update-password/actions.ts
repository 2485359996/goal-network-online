"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../../../src/lib/supabase/server";

const MIN_PASSWORD_LENGTH = 6;

function updatePasswordRedirect(error: string) {
  redirect(`/auth/update-password?error=${encodeURIComponent(error)}`);
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    updatePasswordRedirect("password_too_short");
  }
  if (password !== confirmPassword) {
    updatePasswordRedirect("password_mismatch");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    updatePasswordRedirect("update_failed");
  }

  revalidatePath("/", "layout");
  redirect("/");
}
