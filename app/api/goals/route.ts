import { NextResponse } from "next/server";
import { assertCanWrite, getApiContext, jsonError } from "../../../src/lib/api/context";
import { goalCreateSchema } from "../../../src/lib/api/schemas";
import { SupabaseGoalStore } from "../../../src/lib/stores/goals";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getApiContext();
    return NextResponse.json(await new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id).readGoals());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext();
    assertCanWrite(context.role);
    const body = goalCreateSchema.parse(await request.json());
    return NextResponse.json(await new SupabaseGoalStore(context.admin, context.workspaceId, context.user.id).createGoal(body));
  } catch (error) {
    return jsonError(error);
  }
}
