import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../../src/lib/api/context";
import { goalPatchSchema } from "../../../../src/lib/api/schemas";
import { SupabaseGoalStore } from "../../../../src/lib/stores/goals";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const { id } = await params;
    const body = goalPatchSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id).patchGoal(decodeURIComponent(id), body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const { id } = await params;
    return NextResponse.json(await new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id).deleteGoal(decodeURIComponent(id)));
  } catch (error) {
    return jsonError(error);
  }
}
