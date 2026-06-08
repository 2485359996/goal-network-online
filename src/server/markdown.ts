import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type {
  ActionCreateInput,
  ActionPatchInput,
  GoalActionCandidate,
  GoalActionCandidateInput,
  GoalCreateInput,
  GoalGraphEdge,
  GoalNode,
  GoalPatchInput,
  GoalRelationsInput,
  GoalsResponse,
  MarkdownWriteResult,
  RecordCreateInput,
  RecordSummary,
  RecordType,
  WeeklyAction,
  WeeklyActionsResponse
} from "../shared/types";
import { isPrimaryGoalTitle } from "../shared/goalRules";

const GOAL_FIELDS = [
  "type",
  "id",
  "status",
  "horizon",
  "domain",
  "parent",
  "clarity",
  "priority",
  "progress",
  "color",
  "map_x",
  "map_y",
  "map_positions",
  "supports",
  "depends_on",
  "conflicts_with",
  "last_reviewed",
  "last_progress",
  "tags"
];

const RECORD_FOLDERS: Record<RecordType, string> = {
  plan: "计划",
  review: "复盘",
  "weekly-review": "复盘",
  "progress-log": "进展"
};

const GOAL_FOLDER = "目标";
const UNCATEGORIZED_GOAL_FOLDER = "未分类";
const VALID_STATUSES = new Set(["active", "paused", "done", "archived"]);
const GOAL_REFERENCE_LIST_HEADINGS = ["子方向", "中期目标"] as const;

export function resolveVaultRoot() {
  return process.env.GOAL_NETWORK_VAULT
    ? path.resolve(process.env.GOAL_NETWORK_VAULT)
    : path.resolve(process.cwd(), "..");
}

function relativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function stripQuotes(value: unknown) {
  if (typeof value !== "string") return value;
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function asArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(stripQuotes(item))).filter(Boolean);
  return [String(stripQuotes(value))].filter(Boolean);
}

export function titleFromWikilink(value: string) {
  const raw = String(stripQuotes(value) ?? "").trim();
  const match = raw.match(/^\[\[(.+?)\]\]$/);
  return match ? match[1] : raw;
}

export function asWikilink(value: string) {
  const title = titleFromWikilink(value);
  return title ? `[[${title}]]` : "";
}

function referenceTitle(value: string) {
  return wikilinkTargetTitle(titleFromWikilink(value));
}

function referenceKey(value: string) {
  return referenceTitle(value).replace(/\s+/g, "").toLocaleLowerCase();
}

function referencesSameGoal(left: string, right: string) {
  return referenceKey(left) === referenceKey(right);
}

function numberValue(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function optionalNumberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function mapPositionValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const x = optionalNumberValue((value as Record<string, unknown>).x);
  const y = optionalNumberValue((value as Record<string, unknown>).y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function mapPositionsValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, position]) => [key, mapPositionValue(position)] as const)
    .filter((entry): entry is readonly [string, { x: number; y: number }] => Boolean(entry[0] && entry[1]));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function mergeMapPositions(
  current: unknown,
  patch: NonNullable<GoalPatchInput["map_positions"]>
) {
  const next = { ...(mapPositionsValue(current) ?? {}) };
  for (const [contextId, position] of Object.entries(patch)) {
    if (!contextId) continue;
    if (position === null) {
      delete next[contextId];
      continue;
    }
    next[contextId] = {
      x: Number(position.x),
      y: Number(position.y)
    };
  }
  return Object.keys(next).length ? next : undefined;
}

function cleanLines(lines?: string[]) {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

function parseTitle(body: string, fallback: string) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

function parseSummary(body: string) {
  const match = body.match(/^>\s*\[!summary\].*\n((?:^>.*\n?)*)/m);
  if (!match) return "";
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function replaceSummary(body: string, summary: string) {
  const block = `> [!summary] 目标定义\n> ${summary.trim()}\n`;
  if (/^>\s*\[!summary\]/m.test(body)) {
    return body.replace(/^>\s*\[!summary\].*\n(?:^>.*\n?)*/m, block);
  }
  return body.replace(/^(#\s+.+\n)/m, `$1\n${block}`);
}

function replaceTitle(body: string, title: string) {
  if (/^#\s+.+$/m.test(body)) {
    return body.replace(/^#\s+.+$/m, `# ${title}`);
  }
  return `# ${title}\n\n${body.trimStart()}`;
}

function sectionText(body: string, heading: string) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trimEnd();
}

function listSection(body: string, heading: string) {
  return sectionText(body, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- \[[ xX]\]\s*/, "").replace(/^- /, "").trim())
    .filter(Boolean);
}

function taskListSection(body: string, heading: string): GoalActionCandidate[] {
  return sectionText(body, heading)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const taskMatch = line.match(/^- \[([ xX])\]\s*(.*)$/);
      if (taskMatch) {
        return { text: taskMatch[2].trim(), done: taskMatch[1].toLowerCase() === "x" };
      }
      return { text: line.replace(/^- /, "").trim(), done: false };
    })
    .filter((item) => item.text);
}

function stripGoalReference(value: string, expectedTitle?: string) {
  return value
    .replace(/\s*\bgoal::\s*\[\[([^\]\r\n]+)(?:\]\])?/g, (match, title) =>
      !expectedTitle || referencesSameGoal(`[[${title}]]`, expectedTitle) ? "" : match
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function actionCandidateSection(body: string, goalTitle: string) {
  return taskListSection(body, "行动候选")
    .map((item) => ({ ...item, text: stripGoalReference(item.text, goalTitle) }))
    .filter((item) => item.text);
}

function actionCandidatesForGoal(items: GoalActionCandidateInput[] | undefined, goalTitle: string): GoalActionCandidate[] {
  return (items ?? [])
    .map((item) => {
      if (typeof item === "string") {
        const taskMatch = item.trim().match(/^\[([ xX])\]\s*(.*)$/);
        return {
          text: stripGoalReference(taskMatch ? taskMatch[2] : item),
          done: taskMatch ? taskMatch[1].toLowerCase() === "x" : false
        };
      }
      return {
        text: stripGoalReference(item.text),
        done: Boolean(item.done)
      };
    })
    .filter((item) => item.text);
}

function directionHeading(body: string): "子方向" | "中期目标" {
  return /^##\s+中期目标\s*$/m.test(body) ? "中期目标" : "子方向";
}

function replaceListSection(body: string, heading: string, items: string[], task = false) {
  const list = cleanLines(items);
  const content = list.length
    ? list.map((item) => (task ? `- [ ] ${item}` : `- ${item}`)).join("\n")
    : "- ";
  const block = [`## ${heading}`, ...content.split("\n"), ""];
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start !== -1) {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    lines.splice(start, end - start, ...block);
    return lines.join("\n");
  }
  return `${body.trimEnd()}\n\n${block.join("\n")}`;
}

function replaceTaskListSection(body: string, heading: string, items: GoalActionCandidate[]) {
  const list = items.filter((item) => item.text.trim());
  const content = list.length
    ? list.map((item) => `- [${item.done ? "x" : " "}] ${item.text.trim()}`).join("\n")
    : "- [ ] ";
  const block = [`## ${heading}`, ...content.split("\n"), ""];
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start !== -1) {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        end = index;
        break;
      }
    }
    lines.splice(start, end - start, ...block);
    return lines.join("\n");
  }
  return `${body.trimEnd()}\n\n${block.join("\n")}`;
}

function removeSection(body: string, heading: string) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return body;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function wikilinkTargetTitle(raw: string) {
  return raw.split("|")[0].split("#")[0].trim();
}

function lineReferencesDeletedGoal(line: string, deletedKeys: Set<string>) {
  for (const match of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (deletedKeys.has(referenceKey(wikilinkTargetTitle(match[1])))) return true;
  }
  return false;
}

function removeDeletedGoalListItems(body: string, deletedKeys: Set<string>) {
  if (!deletedKeys.size) return { body, changed: false };

  const lines = body.split(/\r?\n/);
  let changed = false;

  for (const heading of GOAL_REFERENCE_LIST_HEADINGS) {
    const range = sectionLineRange(lines, heading);
    if (!range) continue;

    let sectionChanged = false;
    for (let index = range.end - 1; index > range.start; index -= 1) {
      const line = lines[index];
      if (line.trim().startsWith("- ") && lineReferencesDeletedGoal(line, deletedKeys)) {
        lines.splice(index, 1);
        changed = true;
        sectionChanged = true;
      }
    }

    const nextRange = sectionChanged ? sectionLineRange(lines, heading) : null;
    const hasListItem = nextRange
      ? lines.slice(nextRange.start + 1, nextRange.end).some((line) => {
          const trimmed = line.trim();
          return trimmed.startsWith("- ") && trimmed.replace(/^- /, "").trim();
        })
      : true;

    if (nextRange && !hasListItem) lines.splice(nextRange.start + 1, 0, "- ");
  }

  return { body: changed ? lines.join("\n").replace(/\n{3,}/g, "\n\n") : body, changed };
}

function orderFrontmatter(data: Record<string, unknown>, order: string[]) {
  const next: Record<string, unknown> = {};
  for (const key of order) {
    if (key in data) next[key] = data[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in next)) next[key] = value;
  }
  return next;
}

function stringifyMarkdown(body: string, data: Record<string, unknown>, order = GOAL_FIELDS) {
  return matter.stringify(`${body.trim()}\n`, orderFrontmatter(data, order));
}

function removeGoalDateFields(data: Record<string, unknown>) {
  const next = { ...data };
  delete next.due;
  delete next.next_check_in;
  return next;
}

function isPrimaryRootGoal(title: string, parent: unknown) {
  return isPrimaryGoalTitle(title) && !titleFromWikilink(String(stripQuotes(parent) ?? ""));
}

function fileTitleFromRelativePath(filePath: string) {
  return path.basename(filePath.split("/").pop() ?? filePath, ".md");
}

function referenceAliasesForGoal(goal: Pick<GoalNode, "title" | "filePath">) {
  return [goal.title, fileTitleFromRelativePath(goal.filePath)];
}

function buildGoalReferenceResolver(goals: GoalNode[]) {
  const exact = new Map(goals.map((goal) => [goal.title, goal]));
  const aliases = new Map<string, GoalNode>();
  const ambiguous = new Set<string>();

  for (const goal of goals) {
    for (const alias of referenceAliasesForGoal(goal)) {
      const key = referenceKey(alias);
      if (!key || ambiguous.has(key)) continue;
      const current = aliases.get(key);
      if (current && current.id !== goal.id) {
        aliases.delete(key);
        ambiguous.add(key);
      } else {
        aliases.set(key, goal);
      }
    }
  }

  return (value: string) => {
    const title = referenceTitle(value);
    return exact.get(title) ?? aliases.get(referenceKey(title));
  };
}

function goalReferenceExists(goals: GoalNode[], title: string, exceptId?: string) {
  const key = referenceKey(title);
  return goals.some((goal) => goal.id !== exceptId && referenceAliasesForGoal(goal).some((alias) => referenceKey(alias) === key));
}

function replaceMatchingWikilinks(body: string, oldTitle: string, newTitle: string) {
  return body.replace(/\[\[([^\]]+)\]\]/g, (match, target) =>
    referencesSameGoal(wikilinkTargetTitle(target), oldTitle) ? asWikilink(newTitle) : match
  );
}

async function readMarkdown(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  return { raw, data: parsed.data as Record<string, unknown>, body: parsed.content };
}

async function markdownFiles(folder: string) {
  const files: string[] = [];

  async function collect(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await collect(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(entryPath);
        }
      })
    );
  }

  try {
    await collect(folder);
    return files.sort((a, b) => relativePath(folder, a).localeCompare(relativePath(folder, b), "zh-CN"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function goalIdBase(parentTitle: string, title: string) {
  const cleanParent = titleFromWikilink(parentTitle).trim();
  return cleanParent ? `goal-${cleanParent}-${title.trim()}` : `goal-${title.trim()}`;
}

function uniqueGoalIdFromSet(ids: Set<string>, base: string) {
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function uniqueGoalId(goals: GoalNode[], base: string, exceptId?: string) {
  const ids = new Set(goals.map((goal) => goal.id));
  if (exceptId) ids.delete(exceptId);
  return uniqueGoalIdFromSet(ids, base);
}

function safeFileName(title: string) {
  return title.replace(/[/:\\?%*"<>|]/g, "-").trim();
}

function goalCategoryName(domain: unknown, fallbackTitle: string) {
  const domainTitle = titleFromWikilink(String(stripQuotes(domain) ?? "")).trim();
  return safeFileName(domainTitle || fallbackTitle) || UNCATEGORIZED_GOAL_FOLDER;
}

function goalParentFolderName(parent: unknown, domain: unknown) {
  const parentTitle = titleFromWikilink(String(stripQuotes(parent) ?? "")).trim();
  const domainTitle = titleFromWikilink(String(stripQuotes(domain) ?? "")).trim();
  if (!parentTitle || parentTitle === domainTitle || isPrimaryGoalTitle(parentTitle)) return "";
  return safeFileName(parentTitle);
}

function goalFilePath(root: string, title: string, domain: unknown, parent: unknown) {
  const parentFolder = goalParentFolderName(parent, domain);
  return path.join(
    root,
    GOAL_FOLDER,
    goalCategoryName(domain, title),
    ...(parentFolder ? [parentFolder] : []),
    `${safeFileName(title)}.md`
  );
}

function priorityWeight(value: number | undefined, fallback = 1) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function computeWeightedProgress(goal: GoalNode): number {
  if (goal.children.length === 0) {
    return numberValue(goal.progress, numberValue(goal.clarity, 0));
  }

  const weights = goal.children.map((child) => priorityWeight(child.priority));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weighted = goal.children.reduce((sum, child, index) => {
    const share = totalWeight > 0 ? weights[index] / totalWeight : 1 / goal.children.length;
    return sum + computeWeightedProgress(child) * share;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(weighted)));
}

function applyWeightedProgress(goals: GoalNode[]) {
  for (const goal of goals) {
    if (goal.children.length > 0) goal.progress = computeWeightedProgress(goal);
    applyWeightedProgress(goal.children);
  }
}

function samePath(left: string, right: string) {
  return path.resolve(left) === path.resolve(right);
}

async function assertAvailableTarget(targetPath: string, currentPath?: string) {
  if (currentPath && samePath(targetPath, currentPath)) return;
  try {
    await fs.access(targetPath);
    throw new Error(`目标文件已存在：${path.basename(targetPath)}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function removeEmptyAncestorFolders(baseFolder: string, startFolder: string) {
  const base = path.resolve(baseFolder);
  let current = path.resolve(startFolder);
  while (current !== base && current.startsWith(`${base}${path.sep}`)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length) return;
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timestampId(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export function isoWeek(date = new Date()) {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function actionIdFor(week: string, index: number) {
  return `action-${week}-${String(index).padStart(3, "0")}`;
}

function parseActionLine(line: string, week: string, index: number): WeeklyAction | null {
  const match = line.match(/^- \[([ xX])\]\s+(.+)$/);
  if (!match) return null;
  const raw = match[2];
  const id = raw.match(/\bid::\s*([^\s]+)/)?.[1];
  const goal = raw.match(/\bgoal::\s*(\[\[[^\]]+\]\])/)?.[1] ?? "";
  const due = raw.match(/\bdue::\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  const description = raw
    .replace(/\bid::\s*[^\s]+/g, "")
    .replace(/\bgoal::\s*\[\[[^\]]+\]\]/g, "")
    .replace(/\bdue::\s*\d{4}-\d{2}-\d{2}/g, "")
    .trim();

  return {
    id: id ?? actionIdFor(week, index),
    description,
    goal,
    due,
    done: match[1].toLowerCase() === "x",
    line: index,
    hasStableId: Boolean(id)
  };
}

function actionLine(action: WeeklyAction) {
  const goal = action.goal ? ` goal:: ${asWikilink(action.goal)}` : "";
  const due = action.due ? ` due:: ${action.due}` : "";
  return `- [${action.done ? "x" : " "}] ${action.description} id:: ${action.id}${goal}${due}`;
}

function sectionLineRange(lines: string[], heading: string) {
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }
  return { start, end };
}

async function writeFileEnsured(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export class VaultService {
  constructor(public readonly root = resolveVaultRoot()) {}

  private folder(name: string) {
    return path.join(this.root, name);
  }

  private goalRoot() {
    return this.folder(GOAL_FOLDER);
  }

  private goalFilePath(title: string, domain: unknown, parent: unknown) {
    return goalFilePath(this.root, title, domain, parent);
  }

  async readGoals(): Promise<GoalsResponse> {
    const files = await markdownFiles(this.goalRoot());
    const goals: GoalNode[] = [];

    for (const filePath of files) {
      const { data, body } = await readMarkdown(filePath);
      if (data.type !== "goal") continue;
      const title = parseTitle(body, path.basename(filePath, ".md"));
      const currentDirectionHeading = directionHeading(body);
      const primaryRootGoal = isPrimaryRootGoal(title, data.parent);
      goals.push({
        id: String(data.id ?? `goal-${title}`),
        goalMapId: "root",
        title,
        filePath: relativePath(this.root, filePath),
        status: VALID_STATUSES.has(String(data.status)) ? (String(data.status) as GoalNode["status"]) : "active",
        horizon: String(data.horizon ?? ""),
        domain: String(stripQuotes(data.domain) ?? ""),
        parent: String(stripQuotes(data.parent) ?? ""),
        priority: numberValue(data.priority, 3),
        clarity: numberValue(data.clarity, 1),
        progress: primaryRootGoal ? undefined : numberValue(data.progress, numberValue(data.clarity, 1) * 20),
        color: String(data.color ?? ""),
        map_x: optionalNumberValue(data.map_x),
        map_y: optionalNumberValue(data.map_y),
        map_positions: mapPositionsValue(data.map_positions),
        supports: asArray(data.supports),
        depends_on: asArray(data.depends_on),
        conflicts_with: asArray(data.conflicts_with),
        last_reviewed: String(data.last_reviewed ?? ""),
        last_progress: String(data.last_progress ?? ""),
        tags: asArray(data.tags),
        sections: {
          summary: parseSummary(body),
          directions: listSection(body, currentDirectionHeading),
          directionHeading: currentDirectionHeading,
          successSignals: listSection(body, "成功信号"),
          actionCandidates: primaryRootGoal ? [] : actionCandidateSection(body, title),
          reviewQuestions: listSection(body, "复盘问题")
        },
        children: []
      });
    }

    const resolveGoalReference = buildGoalReferenceResolver(goals);
    const byId = new Map(goals.map((goal) => [goal.id, goal]));
    const topLevel: GoalNode[] = [];

    for (const goal of goals) {
      const parentTitle = referenceTitle(goal.parent);
      const parent = parentTitle ? resolveGoalReference(parentTitle) : undefined;
      if (parent) parent.children.push(goal);
      else topLevel.push(goal);
    }

    const graphNodes = goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      domain: goal.domain,
      status: goal.status,
      priority: goal.priority,
      clarity: goal.clarity
    }));

    const edges: GoalGraphEdge[] = [];
    for (const goal of goals) {
      const parent = resolveGoalReference(goal.parent);
      if (parent) {
        edges.push({ id: `${parent.id}->${goal.id}:parent`, source: parent.id, target: goal.id, type: "parent" });
      }
      for (const type of ["supports", "depends_on", "conflicts_with"] as const) {
        for (const link of goal[type]) {
          const target = resolveGoalReference(link);
          if (target && byId.has(target.id)) {
            edges.push({ id: `${goal.id}->${target.id}:${type}`, source: goal.id, target: target.id, type });
          }
        }
      }
    }

    const sortGoals = (items: GoalNode[]) => {
      items.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "zh-CN"));
      items.forEach((item) => sortGoals(item.children));
    };
    sortGoals(topLevel);
    applyWeightedProgress(topLevel);

    return {
      goalMaps: [{ id: "root", name: "目标网络", sortOrder: 0 }],
      goals: topLevel,
      flatGoals: goals,
      graph: { nodes: graphNodes, edges }
    };
  }

  private async rewriteGoalReferences(oldTitle: string, newTitle: string) {
    if (oldTitle === newTitle) return;
    const { flatGoals } = await this.readGoals();
    const usedIds = new Set(flatGoals.map((goal) => goal.id));
    const files = await markdownFiles(this.goalRoot());
    for (const filePath of files) {
      const { data, body } = await readMarkdown(filePath);
      let changed = false;
      let parentChanged = false;
      const nextData = removeGoalDateFields(data);

      for (const key of ["parent", "domain"] as const) {
        const current = String(stripQuotes(nextData[key]) ?? "");
        if (referencesSameGoal(current, oldTitle)) {
          nextData[key] = asWikilink(newTitle);
          changed = true;
          if (key === "parent") parentChanged = true;
        }
      }

      for (const key of ["supports", "depends_on", "conflicts_with"] as const) {
        const current = asArray(nextData[key]);
        const next = current.map((item) => (referencesSameGoal(item, oldTitle) ? asWikilink(newTitle) : item));
        if (next.join("\n") !== current.join("\n")) {
          nextData[key] = next;
          changed = true;
        }
      }

      const nextBody = replaceMatchingWikilinks(body, oldTitle, newTitle);
      if (nextBody !== body) changed = true;
      if (parentChanged) {
        const currentId = String(stripQuotes(nextData.id) ?? "");
        if (currentId) usedIds.delete(currentId);
        const title = parseTitle(nextBody, path.basename(filePath, ".md"));
        const parentTitle = titleFromWikilink(String(stripQuotes(nextData.parent) ?? ""));
        nextData.id = uniqueGoalIdFromSet(usedIds, goalIdBase(parentTitle, title));
        usedIds.add(String(nextData.id));
        changed = true;
      }
      if (changed) {
        const title = parseTitle(nextBody, path.basename(filePath, ".md"));
        const targetPath = this.goalFilePath(title, nextData.domain, nextData.parent);
        await assertAvailableTarget(targetPath, filePath);
        await writeFileEnsured(targetPath, stringifyMarkdown(nextBody, nextData));
        if (!samePath(targetPath, filePath)) {
          await fs.unlink(filePath);
          await removeEmptyAncestorFolders(this.goalRoot(), path.dirname(filePath));
        }
      }
    }
  }

  private async removeGoalReferences(deletedTitles: Set<string>) {
    const deletedKeys = new Set(Array.from(deletedTitles, referenceKey));
    const files = await markdownFiles(this.goalRoot());
    for (const filePath of files) {
      const { data, body } = await readMarkdown(filePath);
      let changed = false;
      const nextData = removeGoalDateFields(data);
      const nextBody = removeDeletedGoalListItems(body, deletedKeys);
      if (nextBody.changed) changed = true;

      const parent = titleFromWikilink(String(stripQuotes(nextData.parent) ?? ""));
      if (deletedKeys.has(referenceKey(parent))) {
        nextData.parent = "";
        changed = true;
      }

      for (const key of ["supports", "depends_on", "conflicts_with"] as const) {
        const current = asArray(nextData[key]);
        const next = current.filter((item) => !deletedKeys.has(referenceKey(item)));
        if (next.join("\n") !== current.join("\n")) {
          nextData[key] = next;
          changed = true;
        }
      }

      if (changed) await writeFileEnsured(filePath, stringifyMarkdown(nextBody.body, nextData));
    }
  }

  async patchGoal(id: string, input: GoalPatchInput): Promise<MarkdownWriteResult> {
    const { flatGoals } = await this.readGoals();
    const goal = flatGoals.find((item) => item.id === id);
    if (!goal) throw new Error(`未找到目标：${id}`);
    const absolutePath = path.join(this.root, goal.filePath);
    const { data, body } = await readMarkdown(absolutePath);
    const nextData = removeGoalDateFields(data);
    const nextTitle = input.title?.trim();
    if (nextTitle && nextTitle !== goal.title && goalReferenceExists(flatGoals, nextTitle, id)) {
      throw new Error(`目标已存在：${nextTitle}`);
    }

    for (const key of [
      "status",
      "horizon",
      "color",
      "last_reviewed",
      "last_progress"
    ] as const) {
      if (input[key] !== undefined) nextData[key] = input[key];
    }
    if (input.domain !== undefined) nextData.domain = asWikilink(input.domain);
    if (input.parent !== undefined) nextData.parent = input.parent ? asWikilink(input.parent) : "";
    if (nextTitle && input.domain === undefined && titleFromWikilink(String(stripQuotes(nextData.domain) ?? "")) === goal.title) {
      nextData.domain = asWikilink(nextTitle);
    }
    if (input.priority !== undefined) nextData.priority = Number(input.priority);
    if (input.clarity !== undefined) nextData.clarity = Number(input.clarity);
    if (input.map_x !== undefined) {
      if (input.map_x === null) delete nextData.map_x;
      else nextData.map_x = Number(input.map_x);
    }
    if (input.map_y !== undefined) {
      if (input.map_y === null) delete nextData.map_y;
      else nextData.map_y = Number(input.map_y);
    }
    if (input.map_positions !== undefined) {
      const nextPositions = mergeMapPositions(nextData.map_positions, input.map_positions);
      if (nextPositions) nextData.map_positions = nextPositions;
      else delete nextData.map_positions;
      if (input.map_positions.root === null) {
        delete nextData.map_x;
        delete nextData.map_y;
      }
    }

    const nextParent = input.parent !== undefined ? input.parent : goal.parent;
    const primaryRootGoal = isPrimaryRootGoal(nextTitle || goal.title, nextParent);
    const childDerivedProgress = goal.children.length > 0;
    if (primaryRootGoal || childDerivedProgress) {
      delete nextData.progress;
    } else if (input.progress !== undefined) {
      nextData.progress = Number(input.progress);
    }
    if ((nextTitle && nextTitle !== goal.title) || input.parent !== undefined) {
      const parentTitle = titleFromWikilink(String(stripQuotes(nextData.parent) ?? ""));
      nextData.id = uniqueGoalId(flatGoals, goalIdBase(parentTitle, nextTitle || goal.title), id);
    }

    let nextBody = body;
    if (nextTitle) nextBody = replaceTitle(nextBody, nextTitle);
    if (input.summary !== undefined) nextBody = replaceSummary(nextBody, input.summary);
    if (input.directions !== undefined) {
      nextBody = replaceListSection(nextBody, goal.sections.directionHeading, input.directions);
    }
    if (input.successSignals !== undefined) nextBody = replaceListSection(nextBody, "成功信号", input.successSignals);
    if (primaryRootGoal) {
      nextBody = removeSection(nextBody, "行动候选");
    } else if (input.actionCandidates !== undefined) {
      nextBody = replaceTaskListSection(nextBody, "行动候选", actionCandidatesForGoal(input.actionCandidates, nextTitle || goal.title));
    }
    if (input.reviewQuestions !== undefined) nextBody = replaceListSection(nextBody, "复盘问题", input.reviewQuestions);

    const targetTitle = nextTitle || goal.title;
    const targetPath = this.goalFilePath(targetTitle, nextData.domain, nextData.parent);
    await assertAvailableTarget(targetPath, absolutePath);

    await writeFileEnsured(targetPath, stringifyMarkdown(nextBody, nextData));
    if (!samePath(targetPath, absolutePath)) {
      await fs.unlink(absolutePath);
      await removeEmptyAncestorFolders(this.goalRoot(), path.dirname(absolutePath));
    }
    if (nextTitle && nextTitle !== goal.title) await this.rewriteGoalReferences(goal.title, nextTitle);

    return { ok: true, filePath: relativePath(this.root, targetPath), message: "目标已更新" };
  }

  async deleteGoal(id: string): Promise<MarkdownWriteResult> {
    const { flatGoals } = await this.readGoals();
    const goal = flatGoals.find((item) => item.id === id);
    if (!goal) throw new Error(`未找到目标：${id}`);

    const targets: GoalNode[] = [];
    const collect = (item: GoalNode) => {
      targets.push(item);
      item.children.forEach(collect);
    };
    collect(goal);

    const deletedTitles = new Set(targets.map((item) => item.title));
    for (const target of targets) {
      const targetPath = path.join(this.root, target.filePath);
      await fs.unlink(targetPath);
      await removeEmptyAncestorFolders(this.goalRoot(), path.dirname(targetPath));
    }
    await this.removeGoalReferences(deletedTitles);

    return {
      ok: true,
      filePath: targets.map((item) => item.filePath).join(", "),
      message: targets.length === 1 ? "目标已删除" : `目标及 ${targets.length - 1} 个子目标已删除`
    };
  }

  async patchGoalRelations(id: string, input: GoalRelationsInput): Promise<MarkdownWriteResult> {
    const { flatGoals } = await this.readGoals();
    const goal = flatGoals.find((item) => item.id === id);
    if (!goal) throw new Error(`未找到目标：${id}`);
    const absolutePath = path.join(this.root, goal.filePath);
    const { data, body } = await readMarkdown(absolutePath);
    const nextData = {
      ...removeGoalDateFields(data),
      supports: cleanLines(input.supports).map(asWikilink),
      depends_on: cleanLines(input.depends_on).map(asWikilink),
      conflicts_with: cleanLines(input.conflicts_with).map(asWikilink)
    };
    await writeFileEnsured(absolutePath, stringifyMarkdown(body, nextData));
    return { ok: true, filePath: goal.filePath, message: "关系已更新" };
  }

  async createGoal(input: GoalCreateInput): Promise<MarkdownWriteResult> {
    const title = input.title.trim();
    if (!title) throw new Error("目标名称不能为空");
    const { flatGoals } = await this.readGoals();
    if (goalReferenceExists(flatGoals, title)) throw new Error(`目标已存在：${title}`);

    const domainTitle = titleFromWikilink(input.domain || title);
    const parentTitle = titleFromWikilink(input.parent || "");
    const idBase = goalIdBase(parentTitle, title);
    const id = uniqueGoalId(flatGoals, idBase);
    const primaryRootGoal = isPrimaryRootGoal(title, parentTitle);
    const actionCandidates = primaryRootGoal ? [] : actionCandidatesForGoal(input.actionCandidates, title);
    const data = {
      type: "goal",
      id,
      status: "active",
      horizon: input.horizon || "medium",
      domain: asWikilink(domainTitle),
      parent: parentTitle ? asWikilink(parentTitle) : "",
      clarity: input.clarity ?? 1,
      priority: input.priority ?? 50,
      ...(primaryRootGoal ? {} : { progress: input.progress ?? 0 }),
      color: input.color ?? "",
      supports: [],
      depends_on: [],
      conflicts_with: [],
      last_reviewed: "",
      last_progress: "",
      tags: ["goal-network"]
    };
    const filePath = this.goalFilePath(title, data.domain, data.parent);
    await assertAvailableTarget(filePath);
    const body = [
      `# ${title}`,
      "",
      "> [!summary] 目标定义",
      `> ${input.summary?.trim() || "用一句话说明这个目标存在的原因，以及它如何支撑更大的目标。"}`,
      "",
      "## 子方向",
      ...(cleanLines(input.directions).length ? cleanLines(input.directions).map((item) => `- ${item}`) : ["- "]),
      "",
      "## 成功信号",
      ...(cleanLines(input.successSignals).length ? cleanLines(input.successSignals).map((item) => `- ${item}`) : ["- "]),
      ...(primaryRootGoal
        ? []
        : [
            "",
            "## 行动候选",
            ...(actionCandidates.length
              ? actionCandidates.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`)
              : ["- [ ] 行动描述"])
          ]),
      "",
      "## 复盘问题",
      ...(cleanLines(input.reviewQuestions).length
        ? cleanLines(input.reviewQuestions).map((item) => `- ${item}`)
        : ["- 这个目标本周是否有真实进展？", "- 下一步最小行动是什么？"]),
      ""
    ].join("\n");
    await writeFileEnsured(filePath, stringifyMarkdown(body, data));
    return { ok: true, filePath: relativePath(this.root, filePath), message: "目标已创建" };
  }

  private weeklyFile(week = isoWeek()) {
    return path.join(this.folder("行动"), `${week} 下周行动.md`);
  }

  private async ensureWeeklyFile(week = isoWeek()) {
    const filePath = this.weeklyFile(week);
    try {
      await fs.access(filePath);
    } catch {
      const content = matter.stringify(
        [
          `# ${week} 下周行动`,
          "",
          "## 本周焦点",
          "- ",
          "",
          "## 行动清单",
          "- [ ] 行动描述 id:: action-YYYY-Www-001 goal:: [[目标名称]] due:: YYYY-MM-DD",
          "",
          "## 约束",
          "- 本周最多保留 3-5 个关键行动。",
          "- 每个行动必须能在一周内验证是否完成。",
          "- 行动必须链接到一个目标节点。",
          "",
          "## 周末检查",
          "- 完成了什么：",
          "- 卡在哪里：",
          "- 需要更新哪些目标状态或关系：",
          ""
        ].join("\n"),
        {
          type: "weekly-actions",
          week,
          source_review: "",
          tags: ["goal-network/action"]
        },
        {}
      );
      await writeFileEnsured(filePath, content);
    }
    return filePath;
  }

  async readCurrentActions(week = isoWeek()): Promise<WeeklyActionsResponse> {
    const filePath = await this.ensureWeeklyFile(week);
    const { body } = await readMarkdown(filePath);
    const lines = body.split(/\r?\n/);
    const focusRange = sectionLineRange(lines, "本周焦点");
    const actionRange = sectionLineRange(lines, "行动清单");
    const focus = focusRange
      ? lines.slice(focusRange.start + 1, focusRange.end).filter((line) => line.trim().startsWith("- ")).map((line) => line.replace(/^- /, "").trim()).filter(Boolean)
      : [];
    const actions = actionRange
      ? lines.slice(actionRange.start + 1, actionRange.end)
          .map((line, index) => parseActionLine(line.trim(), week, index + 1))
          .filter((action): action is WeeklyAction => Boolean(action))
      : [];
    return { week, filePath: relativePath(this.root, filePath), focus, actions };
  }

  async createAction(input: ActionCreateInput, week = isoWeek()): Promise<MarkdownWriteResult> {
    const filePath = await this.ensureWeeklyFile(week);
    const parsed = await readMarkdown(filePath);
    const lines = parsed.body.split(/\r?\n/);
    const actions = await this.readCurrentActions(week);
    const nextNumber = actions.actions.reduce((max, action) => {
      const match = action.id.match(/-(\d{3})$/);
      return Math.max(max, match ? Number(match[1]) : action.line);
    }, 0) + 1;
    const nextAction: WeeklyAction = {
      id: actionIdFor(week, nextNumber),
      description: input.description.trim(),
      goal: input.goal,
      due: input.due || "",
      done: false,
      line: nextNumber,
      hasStableId: true
    };
    const range = sectionLineRange(lines, "行动清单");
    if (!range) {
      lines.push("", "## 行动清单", actionLine(nextAction));
    } else {
      lines.splice(range.end, 0, actionLine(nextAction));
    }
    await writeFileEnsured(filePath, stringifyMarkdown(lines.join("\n"), parsed.data, ["type", "week", "source_review", "tags"]));
    return { ok: true, filePath: relativePath(this.root, filePath), message: "行动已新增" };
  }

  async patchAction(actionId: string, input: ActionPatchInput, week = isoWeek()): Promise<MarkdownWriteResult> {
    const filePath = await this.ensureWeeklyFile(week);
    const parsed = await readMarkdown(filePath);
    const lines = parsed.body.split(/\r?\n/);
    const range = sectionLineRange(lines, "行动清单");
    if (!range) throw new Error("当前周行动文件缺少行动清单");

    let visibleIndex = 0;
    let targetLine = -1;
    let current: WeeklyAction | null = null;
    for (let index = range.start + 1; index < range.end; index += 1) {
      const parsedAction = parseActionLine(lines[index].trim(), week, visibleIndex + 1);
      if (!parsedAction) continue;
      visibleIndex += 1;
      if (parsedAction.id === actionId) {
        targetLine = index;
        current = parsedAction;
        break;
      }
    }
    if (!current || targetLine === -1) throw new Error(`未找到行动：${actionId}`);
    const nextAction: WeeklyAction = {
      ...current,
      id: current.id,
      description: input.description ?? current.description,
      goal: input.goal ?? current.goal,
      due: input.due ?? current.due,
      done: input.done ?? current.done,
      hasStableId: true
    };
    lines[targetLine] = actionLine(nextAction);
    await writeFileEnsured(filePath, stringifyMarkdown(lines.join("\n"), parsed.data, ["type", "week", "source_review", "tags"]));
    return { ok: true, filePath: relativePath(this.root, filePath), message: "行动已更新" };
  }

  async readRecords(): Promise<RecordSummary[]> {
    const records: RecordSummary[] = [];
    for (const folder of ["计划", "复盘", "进展"]) {
      const files = await markdownFiles(this.folder(folder));
      for (const filePath of files) {
        const { data, body } = await readMarkdown(filePath);
        const type = String(data.type ?? "");
        if (!["plan", "review", "weekly-review", "progress-log"].includes(type)) continue;
        records.push({
          id: String(data.id ?? path.basename(filePath, ".md")),
          type: type as RecordType,
          title: parseTitle(body, path.basename(filePath, ".md")),
          filePath: relativePath(this.root, filePath),
          date: String(data.date ?? ""),
          created: String(data.created ?? ""),
          week: String(data.week ?? ""),
          status: String(data.status ?? ""),
          goals: asArray(data.goals),
          source: String(data.source ?? ""),
          review_scope: String(data.review_scope ?? ""),
          progress_state: String(data.progress_state ?? ""),
          horizon: String(data.horizon ?? "")
        });
      }
    }
    return records.sort((a, b) => (b.date || b.created || b.week || b.id).localeCompare(a.date || a.created || a.week || a.id));
  }

  async createRecord(input: RecordCreateInput): Promise<MarkdownWriteResult> {
    const now = new Date();
    const date = input.date || isoDate(now);
    const week = input.week || isoWeek(now);
    const id = `record-${timestampId(now)}`;
    const folder = this.folder(RECORD_FOLDERS[input.type]);
    const goals = cleanLines(input.goals).map(asWikilink);
    const goalTitle = goals[0] ? titleFromWikilink(goals[0]) : "";

    const data: Record<string, unknown> = {
      id,
      type: input.type,
      source: "web-ui",
      tags: [`goal-network/${input.type === "progress-log" ? "progress" : input.type.includes("review") ? "review" : "plan"}`]
    };
    if (input.type === "weekly-review") {
      data.week = week;
      data.created = date;
    } else if (input.type === "plan") {
      data.created = date;
      data.status = "active";
      data.horizon = input.horizon || "flexible";
      data.goals = goals;
    } else if (input.type === "progress-log") {
      data.date = date;
      data.goals = goals;
      data.progress_state = input.progress_state || "unclear";
      data.status = "confirmed";
    } else {
      data.date = date;
      data.review_scope = input.review_scope || "freeform";
      data.goals = goals;
      data.status = "confirmed";
    }

    const title =
      input.title ||
      (input.type === "weekly-review"
        ? `${week} 周复盘`
        : input.type === "plan"
          ? `${date} 计划`
          : input.type === "progress-log"
            ? `${date}${goalTitle ? ` ${goalTitle}` : ""} 进展记录`
            : `${date} 复盘`);
    const fileName = safeFileName(title);
    let filePath = path.join(folder, `${fileName}.md`);
    try {
      await fs.access(filePath);
      filePath = path.join(folder, `${fileName}-${timestampId(now)}.md`);
    } catch {
      // The first path is available.
    }

    const nextActions = cleanLines(input.nextActions);
    const body = [
      `# ${title}`,
      "",
      input.type === "plan" ? "## 计划对象" : "## 关联目标",
      ...(goals.length ? goals.map((goal) => `- ${goal}`) : ["- "]),
      "",
      "## 摘要",
      input.summary ? `- ${input.summary}` : "- ",
      "",
      "## 事实",
      input.facts ? `- ${input.facts}` : "- ",
      "",
      "## 进展",
      input.progress ? `- ${input.progress}` : "- ",
      "",
      "## 阻碍",
      input.blockers ? `- ${input.blockers}` : "- ",
      "",
      "## 认识更新",
      input.learnings ? `- ${input.learnings}` : "- ",
      "",
      "## 下一步行动",
      ...(nextActions.length ? nextActions.map((item) => `- [ ] ${item}`) : ["- [ ] "]),
      "",
      "## Agent 写入记录",
      "- 修改文件：",
      "- 核心 diff 摘要：",
      "- 用户确认：web-ui direct write",
      ""
    ].join("\n");

    await writeFileEnsured(filePath, matter.stringify(body, data));
    return { ok: true, filePath: relativePath(this.root, filePath), message: "记录已创建" };
  }
}
