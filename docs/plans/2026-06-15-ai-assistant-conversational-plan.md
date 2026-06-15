# AI 助手对话式重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** 把现有 AI 能力从“一次生成后只能手动改”升级为“生成候选草稿后可继续对话和快捷调整”，覆盖浮动 AI 助手与创建目标弹窗。

**Architecture:** 继续复用现有 5 个 AI endpoint，不新建统一 endpoint，不新增数据库表，不持久化聊天历史。共享契约增加 `turn` 和 `clarifyingQuestion`；服务端 prompt 根据 `turn.allowClarification` 控制是否允许追问；两个前端入口各自管理候选草稿、对话 state 和应用动作。

**Tech Stack:** React 19, TypeScript strict, zod v4, Vitest, OpenAI-compatible `/chat/completions` with `response_format: { type: "json_object" }`.

---

## Implementation Constraints

- 不改 `src/client/main.tsx`。对话 state、追问 state、快捷调整逻辑必须自包含在 `AiAssistantDialog` 和 `CreateGoalDialog` 内部。
- AI 只更新当前候选草稿或结构化建议；已有目标仍需用户点击“应用勾选”，新目标仍需用户点击“创建”才写入。
- 不保存聊天历史；`conversation` 只存在当前弹窗会话内。
- 最多一轮动态追问。用户选择答案或跳过后，后续请求必须设置 `allowClarification: false`。
- 如果 `allowClarification: false` 后 provider 仍返回 `clarifyingQuestion`，client 按协议错误处理：不展示追问、不更新候选草稿，显示错误并允许重试。
- 快捷调整 enum 的 AI 语义只在 server prompt 定义；前端只传 enum，不翻译成 AI 指令。
- 实施前运行 `git status --short`，确认没有无关 tracked diff。当前复核状态：tracked 源码无 diff，只有本文档和 `output/` 为 untracked。

## Public Contract

新增共享 turn 字段：

```ts
export const aiTurnIntentSchema = z.enum([
  "generate",
  "message",
  "quick-adjust",
  "clarification-answer"
]);

export const aiQuickAdjustmentSchema = z.enum([
  "too-hard",
  "not-enough-time",
  "lower-frequency",
  "fewer-actions"
]);

export const aiConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1)
}).strict();

export const aiClarificationAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionId: z.string().min(1),
  label: z.string().min(1)
}).strict();

export const aiTurnSchema = z.object({
  intent: aiTurnIntentSchema,
  allowClarification: z.boolean().optional(),
  message: z.string().optional(),
  quickAdjustment: aiQuickAdjustmentSchema.optional(),
  clarificationAnswer: aiClarificationAnswerSchema.optional(),
  conversation: z.array(aiConversationMessageSchema).optional(),
  currentResponse: z.unknown().optional()
}).strict();
```

新增追问响应字段：

```ts
export const aiClarifyingQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1)
  }).strict()).min(2).max(4)
}).strict();
```

响应互斥规则：

- 每个 AI response schema 增加 `clarifyingQuestion?: AiClarifyingQuestion`。
- 当 `clarifyingQuestion` 存在时，只允许同时存在 `warnings`，不允许正式结果字段出现。
- 使用 zod v4 的 `.strict().superRefine()` 实现互斥。`.parse()` 仍可用；不要在 response schema 定义后再 `.extend()` / `.merge()`，如需复用应先通过 helper 组装 shape，再统一加互斥规则。

---

## Task 1: Extend Shared AI Contracts

**Files:**
- Modify: `src/shared/aiContracts.ts`
- Modify: `src/shared/aiContracts.test.ts`

- [ ] **Step 1: Add contract tests**

Update `src/shared/aiContracts.test.ts` with tests that verify:

```ts
expect(improveGoalRequestSchema.safeParse({
  goalId: "goal-delivery",
  goal: validGoalContext,
  parentChain: [],
  children: [],
  siblings: [],
  turn: {
    intent: "quick-adjust",
    allowClarification: false,
    quickAdjustment: "too-hard",
    currentResponse: { summary: "Current summary" }
  }
}).success).toBe(true);

expect(improveGoalResponseSchema.safeParse({
  clarifyingQuestion: {
    id: "scope",
    question: "你更想先调整哪一部分？",
    options: [
      { id: "scope", label: "缩小范围" },
      { id: "cadence", label: "降低频率" }
    ]
  }
}).success).toBe(true);

expect(improveGoalResponseSchema.safeParse({
  summary: "Sharper goal",
  clarifyingQuestion: {
    id: "scope",
    question: "你更想先调整哪一部分？",
    options: [
      { id: "scope", label: "缩小范围" },
      { id: "cadence", label: "降低频率" }
    ]
  }
}).success).toBe(false);
```

Run:

```bash
pnpm exec vitest run src/shared/aiContracts.test.ts
```

Expected: new tests fail before implementation.

- [ ] **Step 2: Implement schemas and types**

In `src/shared/aiContracts.ts`:

- Add the schemas from the Public Contract section.
- Add `turn: aiTurnSchema.optional()` to `baseGoalRequestSchema`.
- Add `turn: aiTurnSchema.optional()` to `draftGoalRequestSchema`.
- Add `clarifyingQuestion` to all response schemas.
- Add a shared helper for response mutual exclusion:

```ts
function withClarification<T extends z.ZodRawShape>(
  shape: T,
  resultFields: Array<keyof T>
) {
  return z.object({
    ...shape,
    clarifyingQuestion: aiClarifyingQuestionSchema.optional(),
    warnings: warningsSchema
  }).strict().superRefine((value, ctx) => {
    if (!value.clarifyingQuestion) return;
    if (resultFields.some((field) => value[field as keyof typeof value] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clarifyingQuestion cannot be returned with result fields"
      });
    }
  });
}
```

Use this helper for `improveGoalResponseSchema`, `suggestSubgoalsResponseSchema`, `diagnoseBranchResponseSchema`, `suggestWeeklyActionsResponseSchema`, and `draftGoalResponseSchema`.

- [ ] **Step 3: Export inferred types**

Export:

```ts
export type AiTurn = z.infer<typeof aiTurnSchema>;
export type AiTurnIntent = z.infer<typeof aiTurnIntentSchema>;
export type AiQuickAdjustment = z.infer<typeof aiQuickAdjustmentSchema>;
export type AiConversationMessage = z.infer<typeof aiConversationMessageSchema>;
export type AiClarifyingQuestion = z.infer<typeof aiClarifyingQuestionSchema>;
export type AiClarificationAnswer = z.infer<typeof aiClarificationAnswerSchema>;
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/shared/aiContracts.test.ts
```

Expected: all contract tests pass.

---

## Task 2: Make Server Prompt Turn-Aware

**Files:**
- Modify: `src/server/ai.ts`
- Modify: `src/server/ai.test.ts`

- [ ] **Step 1: Add server tests**

Update `src/server/ai.test.ts` to cover:

- `runAiProvider()` includes `turn` inside the user message JSON.
- `systemPromptFor(endpoint, request)` includes `clarifyingQuestion` only when `request.turn.allowClarification === true`.
- provider responses containing `clarifyingQuestion` parse through the route contract.

Export `systemPromptFor` from `src/server/ai.ts` so it can be tested.

Example assertion:

```ts
expect(systemPromptFor("improve-goal", {
  goalId: "goal-delivery",
  goal: validGoalContext,
  parentChain: [],
  children: [],
  siblings: [],
  turn: { intent: "generate", allowClarification: true }
})).toContain("clarifyingQuestion");
```

Run:

```bash
pnpm exec vitest run src/server/ai.test.ts
```

Expected: new tests fail before implementation.

- [ ] **Step 2: Pass request into system prompt**

Change `runAiProvider()` from:

```ts
content: systemPromptFor(endpoint)
```

to:

```ts
content: systemPromptFor(endpoint, request)
```

- [ ] **Step 3: Update `systemPromptFor`**

Implement:

```ts
export function systemPromptFor(endpoint: AiEndpoint, request: unknown) {
  const allowClarification = Boolean(
    request &&
      typeof request === "object" &&
      "turn" in request &&
      (request as { turn?: { allowClarification?: boolean } }).turn?.allowClarification === true
  );
  // Build the allowed top-level field list conditionally.
}
```

Prompt requirements:

- Always require one JSON object only.
- When clarification is not allowed, allowed fields must not include `clarifyingQuestion`.
- When clarification is allowed, allowed fields include `clarifyingQuestion`.
- When returning `clarifyingQuestion`, the model must not include result fields.
- For `message` and `quick-adjust`, the model must modify `turn.currentResponse` and preserve unaffected fields.
- Define quick adjustment semantics:
  - `too-hard`: reduce difficulty, scope, prerequisites, or action intensity.
  - `not-enough-time`: shrink the current cycle scope and prefer the next smallest useful step.
  - `lower-frequency`: lower cadence or review/action frequency where the endpoint has cadence semantics.
  - `fewer-actions`: keep only the highest-leverage items.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm exec vitest run src/server/ai.test.ts
```

Expected: server tests pass.

---

## Task 3: Add Shared Client Conversation Helpers

**Files:**
- Create: `src/client/aiConversation.ts`
- Create: `src/client/AiConversationControls.tsx`
- Add or update client tests in `src/client/AiAssistantDialog.test.ts` and `src/client/CreateGoalDialog.test.ts`

- [ ] **Step 1: Add helper tests**

Add tests for pure helpers:

- `availableQuickAdjustmentsForTab("diagnose")` returns `[]`.
- `availableQuickAdjustmentsForTab("weekly")` includes `not-enough-time` and `fewer-actions`.
- `buildAiTurn()` includes `currentResponse` and does not translate quick adjustment enum into instruction text.
- `shouldAllowGoalClarification()` and `shouldAllowDraftClarification()` return false after a clarification answer has already been supplied.

- [ ] **Step 2: Implement `src/client/aiConversation.ts`**

Implement pure helpers without React, framer-motion, or lucide imports:

```ts
export type AiConversationTarget = "improve" | "subgoals" | "diagnose" | "weekly" | "draft-goal";

export function availableQuickAdjustmentsForTarget(target: AiConversationTarget): AiQuickAdjustment[] {
  if (target === "diagnose") return [];
  if (target === "subgoals") return ["too-hard", "not-enough-time"];
  if (target === "weekly") return ["too-hard", "not-enough-time", "fewer-actions", "lower-frequency"];
  return ["too-hard", "not-enough-time", "fewer-actions"];
}
```

Also implement:

- `quickAdjustmentLabel(adjustment)`
- `buildAiTurn({ intent, message, quickAdjustment, conversation, currentResponse, clarificationAnswer, allowClarification })`
- `shouldAllowGoalClarification(...)`
- `shouldAllowDraftClarification(...)`
- `isClarificationOnlyResponse(response)`

Clarification heuristics:

- Existing goal entry:
  - `sparse = goal.clarity <= 2 || (summary empty && successSignals + actionCandidates + reviewQuestions < 2)`.
  - `complex` is target-specific:
    - `diagnose`: false.
    - `subgoals` or `weekly`: `horizon !== "short" || parentChain.length + children.length + siblings.length >= 2`.
    - `improve`: `horizon !== "short" && parentChain.length + children.length + siblings.length >= 3`.
  - allow only when `sparse && complex && !hasClarificationAnswer`.
- Create goal entry:
  - `sparse = title empty/default || (summary empty && successSignals/actionCandidates/reviewQuestions all empty)`.
  - `complex = horizon !== "short" || Boolean(parentGoal) || Boolean(sourceGoal)`.
  - allow only when `sparse && complex && !hasClarificationAnswer`.

- [ ] **Step 3: Implement `AiConversationControls.tsx`**

Component responsibilities:

- Render conversation messages.
- Render free-text input and send button.
- Render quick adjustment buttons passed via props.
- Render `clarifyingQuestion` options when present.
- Render “按现有信息生成” for skipped clarification.

Props shape:

```ts
type AiConversationControlsProps = {
  messages: AiConversationMessage[];
  quickAdjustments: AiQuickAdjustment[];
  clarifyingQuestion?: AiClarifyingQuestion;
  busy: boolean;
  onSendMessage: (message: string) => void;
  onQuickAdjust: (adjustment: AiQuickAdjustment) => void;
  onAnswerClarification: (answer: AiClarificationAnswer) => void;
  onSkipClarification: () => void;
};
```

The component must not call AI APIs and must not mutate goal data.

- [ ] **Step 4: Verify helper tests**

Run:

```bash
pnpm exec vitest run src/client/AiAssistantDialog.test.ts src/client/CreateGoalDialog.test.ts
```

Expected: helper tests pass after implementation.

---

## Task 4: Refactor `AiAssistantDialog`

**Files:**
- Modify: `src/client/AiAssistantDialog.tsx`
- Modify: `src/client/AiAssistantDialog.test.ts`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Add dialog helper tests**

Extend `src/client/AiAssistantDialog.test.ts` to cover:

- `buildImproveGoalPatch()` still strips action candidates for primary goals.
- goal clarification heuristic returns false for `diagnose`.
- protocol error helper rejects a `clarifyingQuestion` when clarification is not allowed.
- `defaultSelections()` is only called for formal responses, not clarification-only responses.

- [ ] **Step 2: Add local dialog state**

In `AiAssistantDialog` add state:

- `messages: AiConversationMessage[]`
- `clarifyingQuestion: AiClarifyingQuestion | null`
- `clarificationAnswered: boolean`
- `lastTurnAllowedClarification: boolean`

Update the existing reset effect for `[activeTab, goal.id]` to clear all new state.

- [ ] **Step 3: Extend request building**

Change `buildAiRequest(tab, goal, flatGoals)` to accept optional `turn`.

When calling AI:

- Generate intent: `turn.intent = "generate"`.
- Free-text: `turn.intent = "message"` and include `message`.
- Quick button: `turn.intent = "quick-adjust"` and include `quickAdjustment`.
- Clarification answer: `turn.intent = "clarification-answer"` and include `clarificationAnswer`.
- Include `currentResponse` for message/quick-adjust/clarification-answer when a formal response exists.
- Include `conversation` for non-initial turns.

- [ ] **Step 4: Split formal response from clarification response**

After `responseSchemas[tab].parse(body)`:

- If `parsed.clarifyingQuestion` exists and the current request allowed clarification, set `clarifyingQuestion`, append an assistant message, and do not call `setResponse`.
- If `parsed.clarifyingQuestion` exists and clarification was not allowed, set an error and do not update `response`.
- Otherwise clear `clarifyingQuestion`, set formal `response`, and call `setSelected(defaultSelections(...))`.

- [ ] **Step 5: Render conversation controls**

Render `AiConversationControls` after a formal response exists or while a clarification question is active.

Pass quick adjustments from `availableQuickAdjustmentsForTarget(activeTab)`.

Keep `diagnose` non-applicable:

```ts
const canApply = response && activeTab !== "diagnose";
```

- [ ] **Step 6: Update styles**

Add styles for:

- `.ai-conversation`
- `.ai-message-list`
- `.ai-message`
- `.ai-quick-actions`
- `.ai-clarifying-question`
- mobile layout under the existing AI dialog media query

Match existing 8px radius controls, restrained panel styling, and existing button classes.

- [ ] **Step 7: Verify**

Run:

```bash
pnpm exec vitest run src/client/AiAssistantDialog.test.ts
```

Expected: tests pass.

---

## Task 5: Refactor `CreateGoalDialog`

**Files:**
- Modify: `src/client/CreateGoalDialog.tsx`
- Modify: `src/client/CreateGoalDialog.test.ts`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Add draft conversation tests**

Update `src/client/CreateGoalDialog.test.ts` to cover:

- `buildCreateGoalAiRequest(context, draft, turn)` includes the optional `turn`.
- `mergeAiDraft()` keeps `color`.
- `shouldAllowDraftClarification()` ignores the removed `mode !== "sibling"` dead condition.
- protocol error handling does not overwrite the current draft when clarification is not allowed.

- [ ] **Step 2: Extend request builder**

Change:

```ts
export function buildCreateGoalAiRequest(context: CreateGoalDialogContext, draft: CreateGoalDraft): AiDraftGoalRequest
```

to:

```ts
export function buildCreateGoalAiRequest(
  context: CreateGoalDialogContext,
  draft: CreateGoalDraft,
  turn?: AiTurn
): AiDraftGoalRequest
```

Include `turn` only when provided.

- [ ] **Step 3: Add local conversation state**

In `CreateGoalDialog` add:

- `messages`
- `clarifyingQuestion`
- `clarificationAnswered`
- `lastTurnAllowedClarification`

Update the existing reset effect for `[initialDraft]` to clear all new state.

- [ ] **Step 4: Refactor AI draft requests**

Refactor `requestGoalDraft(context, draft)` to accept optional `turn`.

When initial “AI 辅助填写” is clicked:

- Build `turn.intent = "generate"`.
- Compute `allowClarification` with `shouldAllowDraftClarification`.
- If provider returns `clarifyingQuestion`, show it and do not update draft.
- If provider returns formal draft, call `mergeAiDraft()`, open details, and keep existing warnings behavior.

When user sends a message or quick adjustment:

- Include latest `draft` as `turn.currentResponse`.
- Include current `conversation`.
- Show a UI hint near controls: `AI 会基于当前表单内容重写候选草稿。`

- [ ] **Step 5: Render shared controls**

Render `AiConversationControls` below AI status/warnings and above the form grid.

Use target `"draft-goal"` for quick adjustment availability.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm exec vitest run src/client/CreateGoalDialog.test.ts
```

Expected: tests pass.

---

## Task 6: End-to-End Verification

**Files:**
- All files touched by Tasks 1-5

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run src/shared/aiContracts.test.ts src/server/ai.test.ts src/client/AiAssistantDialog.test.ts src/client/CreateGoalDialog.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: TypeScript and Next build pass.

- [ ] **Step 4: Manual smoke checks**

Start local dev server:

```bash
pnpm dev
```

Manual scenarios:

- Open floating AI assistant on a sparse complex goal; initial generation may show one multiple-choice clarification.
- Answer clarification; next AI call generates formal structured content.
- Use “太难” or “时间不够”; candidate result updates, data is not written until “应用勾选”.
- Switch tab or goal; previous conversation and clarification state are cleared.
- Open create goal dialog; AI can ask one clarification or fill the draft.
- Manually edit draft, then send an AI adjustment; AI uses latest draft as `currentResponse`, and user still must click “创建”.
- Diagnose tab shows free conversation controls but no quick buttons and no apply button.

- [ ] **Step 5: Check git boundaries**

```bash
git status --short
git diff --stat
```

Expected:

- No changes to `src/client/main.tsx`.
- No database migration files.
- No unrelated `output/` changes included in the implementation commit.
