import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../src/lib/api/context";
import { goalMapCreateSchema } from "../../../src/lib/api/schemas";
import { SupabaseGoalStore } from "../../../src/lib/stores/goals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const body = goalMapCreateSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id).createGoalMap(body));
  } catch (error) {
    return jsonError(error);
  }
}
