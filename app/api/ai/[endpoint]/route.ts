import { NextResponse } from "next/server";
import { z } from "zod";
import { aiRouteContracts, type AiEndpoint } from "../../../../src/shared/aiContracts";
import { AI_PROVIDER_NOT_CONFIGURED, runAiProvider } from "../../../../src/server/ai";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ endpoint: string }> }) {
  const { endpoint } = await params;
  if (!(endpoint in aiRouteContracts)) {
    return NextResponse.json({ error: "Unknown AI endpoint" }, { status: 404 });
  }

  const key = endpoint as AiEndpoint;
  const contract = aiRouteContracts[key];
  try {
    const parsed = contract.request.parse(await request.json());
    const result = await runAiProvider(key, parsed, { readLocalEnv: () => ({}) });
    return NextResponse.json(contract.response.parse(result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid AI request", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: message === AI_PROVIDER_NOT_CONFIGURED ? 501 : 500 });
  }
}
