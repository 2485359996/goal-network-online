import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../../../src/lib/api/context";
import { actionPatchSchema } from "../../../../../src/lib/api/schemas";
import { SupabaseActionStore } from "../../../../../src/lib/stores/actions";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const { actionId } = await params;
    const body = actionPatchSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseActionStore(context.admin, context.workspaceId, context.user.id).patchAction(decodeURIComponent(actionId), body));
  } catch (error) {
    return jsonError(error);
  }
}
