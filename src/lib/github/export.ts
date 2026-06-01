import { App } from "@octokit/app";
import type { SupabaseAdminClient } from "../supabase/admin";
import { buildGoalsResponse, type GoalDbRow, type GoalRelationDbRow } from "../stores/goals";

type WorkspaceGitHubConfig = {
  id: string;
  github_installation_id: number | null;
  github_repository_full_name: string | null;
  github_branch: string | null;
};

function getGitHubApp() {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!appId || !privateKey) throw new Error("GitHub App env is not configured");
  return new App({ appId, privateKey });
}

function goalMarkdown(goal: ReturnType<typeof buildGoalsResponse>["flatGoals"][number]) {
  const lines = [
    "---",
    "type: goal",
    `id: ${goal.id}`,
    `status: ${goal.status}`,
    `horizon: ${goal.horizon}`,
    `domain: '${goal.domain}'`,
    `parent: '${goal.parent}'`,
    `clarity: ${goal.clarity}`,
    `priority: ${goal.priority}`,
    ...(goal.progress === undefined ? [] : [`progress: ${goal.progress}`]),
    `color: '${goal.color}'`,
    "tags:",
    ...goal.tags.map((tag) => `  - ${tag}`),
    "---",
    "",
    `# ${goal.title}`,
    "",
    "> [!summary] 目标定义",
    `> ${goal.sections.summary}`,
    "",
    `## ${goal.sections.directionHeading === "中期目标" ? "中期目标" : "子方向"}`,
    ...(goal.sections.directions.length ? goal.sections.directions.map((item) => `- ${item}`) : ["- "]),
    "",
    "## 成功信号",
    ...(goal.sections.successSignals.length ? goal.sections.successSignals.map((item) => `- ${item}`) : ["- "]),
    ...(goal.sections.actionCandidates.length
      ? ["", "## 行动候选", ...goal.sections.actionCandidates.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`)]
      : []),
    "",
    "## 复盘问题",
    ...(goal.sections.reviewQuestions.length ? goal.sections.reviewQuestions.map((item) => `- ${item}`) : ["- "]),
    ""
  ];
  return lines.join("\n");
}

export async function exportWorkspaceToGitHub(client: SupabaseAdminClient, workspaceId: string) {
  const workspaceResult = await client
    .from("workspaces")
    .select("id, github_installation_id, github_repository_full_name, github_branch")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceResult.error) throw workspaceResult.error;
  const workspace = workspaceResult.data as WorkspaceGitHubConfig | null;
  if (!workspace?.github_installation_id || !workspace.github_repository_full_name) {
    throw new Error("Workspace GitHub sync is not configured");
  }

  const [goals, relations] = await Promise.all([
    client.from("goals").select("*").eq("workspace_id", workspaceId),
    client.from("goal_relations").select("*").eq("workspace_id", workspaceId)
  ]);
  if (goals.error) throw goals.error;
  if (relations.error) throw relations.error;

  const response = buildGoalsResponse((goals.data ?? []) as GoalDbRow[], (relations.data ?? []) as GoalRelationDbRow[], workspaceId);
  const [owner, repo] = workspace.github_repository_full_name.split("/");
  if (!owner || !repo) throw new Error("Invalid GitHub repository name");

  const octokit = (await getGitHubApp().getInstallationOctokit(workspace.github_installation_id)) as any;
  const branch = workspace.github_branch || "main";
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.data.object.sha });
  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree: response.flatGoals.map((goal) => ({
      path: goal.filePath,
      mode: "100644",
      type: "blob",
      content: goalMarkdown(goal)
    }))
  });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `Export goal network ${new Date().toISOString()}`,
    tree: tree.data.sha,
    parents: [ref.data.object.sha]
  });
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha
  });
  return commit.data.sha;
}
