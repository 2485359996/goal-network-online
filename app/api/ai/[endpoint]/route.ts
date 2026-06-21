import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, getApiContext } from "../../../../src/lib/api/context";
import { aiRouteContracts, type AiEndpoint } from "../../../../src/shared/aiContracts";
import { AI_PROVIDER_NOT_CONFIGURED, runAiProvider } from "../../../../src/server/ai";
import { buildServerAiRequest } from "../../../../src/server/aiContext";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await params;
  if (!(endpoint in aiRouteContracts)) {
    return NextResponse.json({ error: "Unknown AI endpoint" }, { status: 404 });
  }

  const key = endpoint as AiEndpoint;
  const contract = aiRouteContracts[key];

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "AI 请求格式无效" }, { status: 400 });
  }

  const parsed = contract.request.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "AI 请求格式无效", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getApiContext();
    const providerRequest = await buildServerAiRequest(key, parsed.data, {
      client: context.admin,
      workspaceId: context.workspaceId,
      actorUserId: context.user.id
    });
    const result = await runAiProvider(key, providerRequest, { readLocalEnv: () => ({}) });
    const parsedResult = contract.response.safeParse(result);
    if (!parsedResult.success) {
      return NextResponse.json({ error: "AI 返回格式不符合预期", issues: parsedResult.error.issues }, { status: 502 });
    }
    return NextResponse.json(parsedResult.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "AI 上下文格式异常", issues: error.issues }, { status: 500 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: message === AI_PROVIDER_NOT_CONFIGURED ? 501 : 500 });
  }
}
