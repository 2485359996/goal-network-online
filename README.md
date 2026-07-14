# 目标网络（Goal Network）

> 把职业发展、个人成长与幸福生活中的长期愿望，组织成一张可以看见、调整、复盘并持续推进的星图。

![目标网络](./public/goal-network-og.svg)

目标网络是一款面向个人长期成长的在线目标管理应用。它不把人生目标呈现为待办列表或绩效仪表盘，而是将目标、层级、行动与进展可视化为一张安静的浮空星图，帮助用户看清方向之间的联系，并把长期愿景持续落实到每周行动中。

## 核心能力

- **多张目标地图**：在同一工作区维护多套彼此独立的目标网络。
- **星图式可视化**：提供 Goalscape 浮空地图、径向视图与 3D 目标网格，在不同尺度观察目标结构。
- **层级目标管理**：创建、编辑和拆解目标；子目标进度按重要性加权汇总至父目标。
- **行动与复盘闭环**：连接目标、周行动、进展记录和复盘内容。
- **结构化 AI 助手**：支持优化目标、拆解子目标、诊断分支、建议本周行动和生成目标草稿；所有建议均由用户确认后写入。
- **在线同步与权限**：基于 Supabase Auth、Postgres、RLS 和 Realtime，支持多工作区数据隔离与实时刷新。
- **GitHub 数据导出**：通过异步任务将目标网络导出为可版本化的 Markdown 数据资产。
- **可访问性与主题**：支持深色/浅色主题、键盘操作、ARIA 标签和 `prefers-reduced-motion`。

## 技术栈

- [Next.js 16](https://nextjs.org/)（App Router）与 [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)（严格模式）
- [Supabase](https://supabase.com/)（Postgres、Auth、Realtime、RLS、Storage）
- [Three.js](https://threejs.org/) 与 `3d-force-graph`
- [GSAP](https://gsap.com/) 与 [Framer Motion](https://www.framer.com/motion/)
- [Vitest](https://vitest.dev/)
- [Vercel](https://vercel.com/)（部署与定时任务）

## 本地运行

### 1. 准备环境

- Node.js 20 或更高版本
- pnpm 10.33.0
- 一个 Supabase 项目

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

填写以下变量：

| 变量 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端管理与后台任务 |
| `CRON_SECRET` | 定时任务接口鉴权 |
| `AI_PROVIDER_URL` | OpenAI 兼容服务地址 |
| `AI_PROVIDER_KEY` | AI 服务密钥 |
| `AI_PROVIDER_MODEL` | AI 模型名称 |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App 私钥 |
| `GITHUB_WEBHOOK_SECRET` | GitHub Webhook 签名密钥 |

AI 与 GitHub 同步相关变量可在启用对应能力时配置。不要把 `.env.local` 或任何密钥提交到仓库。

### 4. 初始化数据库

使用 Supabase CLI 将 `supabase/migrations/` 中的迁移应用到目标项目：

```bash
pnpm dlx supabase init
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <your-project-ref>
pnpm dlx supabase db push
```

同时请在 Supabase Authentication 中配置站点 URL、允许的回调地址和邮箱登录策略。

### 5. 启动开发服务器

```bash
pnpm dev
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动本地开发服务器 |
| `pnpm build` | 执行 TypeScript 检查并构建生产版本 |
| `pnpm start` | 启动生产服务器 |
| `pnpm test` | 运行完整 Vitest 测试套件 |
| `pnpm test <file>` | 运行指定测试文件 |

## 架构概览

```text
浏览器（React / Goalscape / 3D Mesh）
        │
        ├── /api/goals、/api/goal-maps、/api/actions、/api/records
        ├── /api/ai/[endpoint]
        └── Supabase Realtime 订阅
                    │
          Next.js Route Handlers
                    │
            SupabaseGoalStore
                    │
      Supabase Postgres + Auth + RLS
                    │
           audit_events / sync_jobs
                    │
             GitHub Markdown 导出
```

运行时数据以 Supabase 为准。API 路由负责身份与权限校验、Zod 参数校验和领域操作；Postgres RLS 按工作区成员关系实施多租户隔离。目标变更会生成审计事件和异步同步任务，Vercel Cron 每日调用 `/api/cron/drain-jobs` 处理待执行任务。

## 目录结构

```text
app/                    Next.js 页面、认证流程与 API 路由
src/client/             星图界面、布局引擎与交互组件
src/lib/stores/         Supabase 运行时数据存储
src/lib/supabase/       浏览器、服务端与管理客户端
src/lib/github/         GitHub 导出与 Webhook
src/server/             AI 服务与上下文构建
src/shared/             类型、规则与 AI 合约
supabase/migrations/    数据库 Schema、RLS 与迁移
public/                 公共静态资源
```

## 部署

项目已包含 `vercel.json`，可直接部署到 Vercel。部署前请：

1. 在 Vercel 配置与 `.env.example` 对应的环境变量。
2. 将 Supabase 的站点 URL 和回调地址更新为正式域名。
3. 设置同一份 `CRON_SECRET`，用于保护定时任务接口。
4. 如需 GitHub 导出，完成 GitHub App 安装并配置 App ID、私钥和 Webhook Secret。

## 设计原则

- 星图而非报表
- 安静的力量感
- 进度是发光，而不是填充
- 温暖的表层，精密的数据结构
- 尊重用户判断与数据所有权

更完整的产品背景与视觉规范，请参阅 [PRODUCT.md](./PRODUCT.md) 和 [DESIGN.md](./DESIGN.md)。
