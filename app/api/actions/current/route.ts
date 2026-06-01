import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../../src/lib/api/context";
import { actionCreateSchema } from "../../../../src/lib/api/schemas";
import { SupabaseActionStore } from "../../../../src/lib/stores/actions";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getApiContext();
    return NextResponse.json(await new SupabaseActionStore(context.admin, context.workspaceId, context.user.id).readCurrentActions());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const body = actionCreateSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseActionStore(context.admin, context.workspaceId, context.user.id).createAction(body));
  } catch (error) {
    return jsonError(error);
  }
}
