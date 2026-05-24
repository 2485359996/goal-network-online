import path from "node:path";
import cors from "@fastify/cors";
import chokidar from "chokidar";
import Fastify from "fastify";
import { z } from "zod";
import { VaultService, resolveVaultRoot } from "./markdown";

const host = "127.0.0.1";
const port = Number(process.env.GOAL_NETWORK_API_PORT ?? 8787);
const vault = new VaultService(resolveVaultRoot());
const app = Fastify({ logger: true });
const clients = new Set<NodeJS.WritableStream>();

await app.register(cors, {
  origin: ["http://127.0.0.1:5173", "http://localhost:5173"]
});

function sendEvent(payload: unknown) {
  const body = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(body);
  }
}

const watcher = chokidar.watch(["目标", "行动", "计划", "复盘", "进展", "模板"].map((folder) => path.join(vault.root, folder)), {
  ignoreInitial: true,
  depth: 4,
  awaitWriteFinish: {
    stabilityThreshold: 160,
    pollInterval: 60
  }
});

watcher.on("all", (event, filePath) => {
  sendEvent({
    event,
    filePath: path.relative(vault.root, filePath).split(path.sep).join("/"),
    at: new Date().toISOString()
  });
});

const goalPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  horizon: z.string().optional(),
  domain: z.string().optional(),
  parent: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  clarity: z.number().min(1).max(5).optional(),
  progress: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  last_reviewed: z.string().optional(),
  last_progress: z.string().optional(),
  summary: z.string().optional(),
  directions: z.array(z.string()).optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(z.string()).optional(),
  reviewQuestions: z.array(z.string()).optional()
});

const goalCreateSchema = z.object({
  title: z.string().min(1),
  domain: z.string().min(1),
  parent: z.string().optional(),
  horizon: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  clarity: z.number().min(1).max(5).optional(),
  progress: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  summary: z.string().optional(),
  directions: z.array(z.string()).optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(z.string()).optional(),
  reviewQuestions: z.array(z.string()).optional()
});

const relationsSchema = z.object({
  supports: z.array(z.string()),
  depends_on: z.array(z.string()),
  conflicts_with: z.array(z.string())
});

const actionCreateSchema = z.object({
  description: z.string().min(1),
  goal: z.string().min(1),
  due: z.string().optional()
});

const actionPatchSchema = z.object({
  description: z.string().optional(),
  goal: z.string().optional(),
  due: z.string().optional(),
  done: z.boolean().optional()
});

const recordCreateSchema = z.object({
  type: z.enum(["plan", "review", "weekly-review", "progress-log"]),
  goals: z.array(z.string()).default([]),
  title: z.string().optional(),
  date: z.string().optional(),
  week: z.string().optional(),
  review_scope: z.string().optional(),
  progress_state: z.enum(["moving", "blocked", "paused", "done", "unclear"]).optional(),
  horizon: z.string().optional(),
  summary: z.string().optional(),
  facts: z.string().optional(),
  progress: z.string().optional(),
  blockers: z.string().optional(),
  learnings: z.string().optional(),
  nextActions: z.array(z.string()).optional()
});

function handleError(error: unknown, reply: { code: (status: number) => { send: (payload: unknown) => void } }) {
  const message = error instanceof Error ? error.message : "未知错误";
  const status = message.includes("未找到") ? 404 : message.includes("已存在") ? 409 : 400;
  reply.code(status).send({ error: message });
}

app.get("/api/health", async () => ({
  ok: true,
  vaultRoot: vault.root
}));

app.get("/api/goals", async () => vault.readGoals());

app.post("/api/goals", async (request, reply) => {
  try {
    return await vault.createGoal(goalCreateSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.patch("/api/goals/:id", async (request, reply) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return await vault.patchGoal(id, goalPatchSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.delete("/api/goals/:id", async (request, reply) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return await vault.deleteGoal(id);
  } catch (error) {
    return handleError(error, reply);
  }
});

app.patch("/api/goals/:id/relations", async (request, reply) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return await vault.patchGoalRelations(id, relationsSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.get("/api/actions/current", async () => vault.readCurrentActions());

app.post("/api/actions/current", async (request, reply) => {
  try {
    return await vault.createAction(actionCreateSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.patch("/api/actions/current/:actionId", async (request, reply) => {
  try {
    const { actionId } = z.object({ actionId: z.string() }).parse(request.params);
    return await vault.patchAction(actionId, actionPatchSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.get("/api/records", async () => vault.readRecords());

app.post("/api/records", async (request, reply) => {
  try {
    return await vault.createRecord(recordCreateSchema.parse(request.body));
  } catch (error) {
    return handleError(error, reply);
  }
});

app.get("/api/events", (_request, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  reply.raw.write("\n");
  clients.add(reply.raw);
  reply.raw.on("close", () => {
    clients.delete(reply.raw);
  });
});

const close = async () => {
  await watcher.close();
  await app.close();
};

process.on("SIGINT", () => void close().then(() => process.exit(0)));
process.on("SIGTERM", () => void close().then(() => process.exit(0)));

await app.listen({ host, port });
