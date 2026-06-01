import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../src/lib/supabase/admin";
import { drainSyncJobs } from "../../../../src/lib/stores/syncJobs";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const results = await drainSyncJobs(getSupabaseAdmin(), 20);
  return NextResponse.json({ ok: true, processed: results.length, results });
}
