import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../../src/lib/api/context";
import { goalMapPositionsClearSchema, goalMapPositionsSetSchema } from "../../../../src/lib/api/schemas";
import { SupabaseGoalStore } from "../../../../src/lib/stores/goals";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const rawBody = await request.json();
    const store = new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id);
    if (rawBody && typeof rawBody === "object" && "positions" in rawBody) {
      const body = goalMapPositionsSetSchema.parse(rawBody);
      return NextResponse.json(await store.setGoalMapPositions(body.positions, body.mapContextId));
    }

    const body = goalMapPositionsClearSchema.parse(rawBody);
    return NextResponse.json(await store.clearGoalMapPositions(body.ids, body.mapContextId));
  } catch (error) {
    return jsonError(error);
  }
}
