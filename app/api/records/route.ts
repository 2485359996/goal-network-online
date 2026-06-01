import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../src/lib/api/context";
import { recordCreateSchema } from "../../../src/lib/api/schemas";
import { SupabaseRecordStore } from "../../../src/lib/stores/records";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getApiContext();
    return NextResponse.json(await new SupabaseRecordStore(context.admin, context.workspaceId, context.user.id).readRecords());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const body = recordCreateSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseRecordStore(context.admin, context.workspaceId, context.user.id).createRecord(body));
  } catch (error) {
    return jsonError(error);
  }
}
