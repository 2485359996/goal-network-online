---
name: 目标网络
description: 浮空星图式个人目标可视化管理系统
colors:
  nebula-purple: "#6366f1"
  nebula-purple-deep: "#4f46e5"
  nebula-purple-soft: "#f0f2fe"
  aurora-green: "#10b981"
  stellar-gold: "#f59e0b"
  sky-blue: "#0284c7"
  vault-blue: "#3b82f6"
  celestial-slate: "#64748b"
  ink-deep: "#0f172a"
  ink-soft: "#334155"
  muted: "#64748b"
  surface-light: "#ffffff"
  surface-raised: "#f1f5f9"
  surface-muted: "#e2e8f0"
  bg-light: "#f8fafc"
  bg-dark: "#0f172a"
  surface-dark: "#172033"
  danger: "#ef4444"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro SC', 'SF Pro Display', 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro SC', 'SF Pro Display', 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro SC', 'SF Pro Display', 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro SC', 'SF Pro Display', 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  map-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro SC', 'SF Pro Display', 'PingFang SC', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "28px"
    fontWeight: 860
    lineHeight: 1.1
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  section: "32px"
  hero: "40px"
components:
  button-primary:
    backgroundColor: "{colors.nebula-purple}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.nebula-purple-deep}"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-icon:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.md}"
    size: "36px"
  button-danger:
    backgroundColor: "{colors.nebula-purple-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  chip-status-active:
    backgroundColor: "#ecfdf5"
    textColor: "#059669"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
    height: "24px"
  chip-child:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
    height: "32px"
  input-default:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "38px"
  panel-glass:
    backgroundColor: "rgba(255, 255, 255, 0.75)"
    rounded: "{rounded.panel}"
---

# Design System: 目标网络

## 1. Overview

**Creative North Star: "能量星图"**

目标网络的视觉系统是一幅私人天文图。用户打开它，如同深夜推开天文台的穹顶：星图缓缓展开，岛屿悬浮在半透明的轨道之间，能量通过悬索桥从中心珍珠流向外围。每个目标节点不是一个任务卡片，而是一颗正在凝聚的星体；进度不是一个百分比条，而是星核从暗淡到炽热的光芒变化。

系统拒绝一切让人联想到绩效考核的视觉语言：没有数据仪表盘的密集图表，没有效率工具的白色卡片网格，没有催促感的红绿灯状态色。取而代之的是天体力学的从容、水晶玻璃的克制光泽、以及能量流动的温暖金色。

浅色主题是晨雾中的星图（柔和的蓝灰梯度背景，半透明玻璃面板），深色主题是深夜的天文台（近黑的靛蓝底色，星光在暗处更为分明）。两个主题共享同一套天体色彩，但明度和饱和度随环境光反转。

**Key Characteristics:**
- 浮空感：节点带有缓慢的上下呼吸动画，连接线带有流动的能量粒子
- 水晶态：面板使用 `backdrop-filter: blur()` 实现半透明玻璃效果，边框是微弱的白色光泽
- 天体配色：三个生命领域（幸福/成长/职业）各有一个专属天体色
- 安静动效：所有动画周期 ≥4 秒，无弹跳无弹性，exponential ease-out
- 双主题：浅色/深色切换由 `[data-theme="dark"]` 驱动，token 完整镜像

## 2. Colors: 天体色谱

色彩体系建立在三个"生命领域"的天体隐喻之上，辅以功能性中性色和状态色。策略为 Full palette：四个命名角色各有职责，通过出现频率而非饱和度区分主次。

### Primary

- **星云紫** (#6366f1 / oklch(55% 0.22 264)): 个人成长领域的灵魂色，也是全局 accent。用于强调按钮、选中态的光晕、focus ring。在地图中代表认知与精神维度。

### Secondary

- **极光绿** (#10b981 / oklch(68% 0.16 163)): 幸福生活领域色。用于完成态徽章、成功通知、生命领域节点的基底色。传递健康与安心。
- **天穹蓝** (#0284c7 / oklch(55% 0.14 230)): 职业发展领域色。用于职业类节点、选中高亮的辅助色。传递清醒与方向感。

### Tertiary

- **恒星金** (#f59e0b / oklch(76% 0.16 75)): 成就与能量色。专用于 100% 达成的土星金环、中心珍珠的暖光辉、能量流动粒子。极少出现，出现即庆典。

### Neutral

- **深墨** (#0f172a): 浅色主题文字/深色主题背景。最深的锚点。
- **软墨** (#334155): 次要文字、描述性内容。
- **天穹灰** (#64748b): 占位符、禁用态、分隔线附近的静音文字。
- **晨雾白** (#f8fafc): 浅色主题的 body 背景。冷调、无明确的暖倾向。
- **玻璃白** (rgba(255, 255, 255, 0.75)): 面板的半透明基底。

### Named Rules

**恒星金稀缺法则。** 恒星金 (#f59e0b) 仅在目标达成 100% 或中心珍珠的能量核心出现。它的稀缺是设计意图：像真正的超新星，出现本身就是事件。任何把它用作"普通警告色"或"标签高亮"的冲动都违背了这个系统。

**领域色归属法则。** 星云紫、极光绿、天穹蓝各自绑定一个生命领域，不可互换。地图上的节点颜色由 `domain` 字段自动派生，不允许手动覆盖为另一个领域的色。

## 3. Typography

**Display Font:** SF Pro SC / PingFang SC / system-ui (中文优先系统字体栈)
**Body Font:** 同上
**Label Font:** 同上

**Character:** 整个系统使用单一字体栈，依赖权重梯度（400→600→700→860）和尺寸跨度（13px→28px）建立层次。没有装饰性字体；天文台的精密感来自字重的精确控制和极小的负 letter-spacing，而非字体本身的造型。中文环境下，系统字体的清晰度和一致性优先于风格表达。

### Hierarchy

- **Map Title** (860, 28px, line-height 1.1): 地图中一级节点的标签。最高权重，配合 paint-order stroke 实现白色描边可读性。
- **Display** (700, 26px, line-height 1.1, letter-spacing -0.01em): 应用标题、页面 h1。
- **Headline** (600, 20px, line-height 1.2, letter-spacing -0.01em): 面板标题、对话框 h2、详情面板 heading。
- **Body** (400, 14-15px, line-height 1.65): 描述文字、笔记内容、对话框正文。
- **Label** (600, 13px, line-height 1.2, letter-spacing 0.01em): 表单标签、按钮文字、指标名称、状态徽章。

### Named Rules

**无衬线唯一法则。** 整个系统只有一个字体栈。不引入第二字体。层次通过 weight (400→860 的可变范围) 和 size 建立。

## 4. Elevation: 梦境分层

系统使用 tonal layering + 柔和阴影的混合策略。静止时，层次由背景透明度的梯度区分（从 body bg 到 panel 的 rgba 白色透明层）。交互时（hover/focus/drag），阴影增强并附带微小的 Y 轴位移（translateY(-1px) to (-4px)）。

### Shadow Vocabulary

- **ambient-soft** (`0 4px 6px -1px rgba(15, 23, 42, 0.05), 0 2px 4px -2px rgba(15, 23, 42, 0.05), 0 12px 24px -4px rgba(15, 23, 42, 0.04)`): 静止态卡片、面板的底层呼吸。
- **elevated-pop** (`0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.08)`): hover 提升、弹窗、浮层菜单。
- **dream-float** (`0 20px 40px -10px rgba(15, 23, 42, 0.08), 0 0 1px rgba(15, 23, 42, 0.04)`): 主面板（地图窗格、详情面板）的标志性深远投影。配合 backdrop-filter: blur(20px) 实现梦境玻璃态。

### Named Rules

**浮力感法则。** 静止时阴影极淡（几乎不可见），元素仿佛悬浮在无重力中。只在用户交互时（hover、drag、focus）阴影才加深加远，如同手指触碰让岛屿下沉了一点点。

## 5. Components

### Buttons

水晶与温感：按钮是半透明的宝石切面，不是扁平的色块。

- **Shape:** 轻柔圆角 (8px radius)，36px 固定高度
- **Primary:** 星云紫实色填充 (#6366f1)，白色文字，1px 深色边框，底部带一道极淡的紫色光晕阴影 (`0 4px 12px rgba(99, 102, 241, 0.12)`)
- **Hover / Focus:** 背景加深至 #4f46e5，Y 轴上移 1px，光晕扩散。transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1)（弹簧式 ease-out）
- **Secondary:** 白色背景 + 1px 边框 + 软墨文字。hover 时背景变为 raised surface，边框加深。
- **Danger:** 极浅红底 + 红色文字。从不使用红色实色填充按钮（避免警报感）。
- **Icon Button:** 36×36 正方形，white bg + 1px border，hover 时轻微提升。

### Chips / Status Badges

- **Status badge:** pill 形 (999px radius), 24px 高, 极淡背景色 + 对应文字色。`active` = 浅绿底/绿字, `paused` = 浅琥珀底/琥珀字, `done` = 浅蓝底/蓝字, `archived` = 浅灰底/灰字。
- **Child pill:** pill 形, 32px 高, white bg + 1px border + 软墨文字。hover 时提升 1px + 加深阴影。连接到子目标的快速跳转胶囊。

### Cards / Containers (Panels)

水晶面板是系统的标志组件。

- **Corner Style:** 圆润的 16px radius (panel-level)
- **Background:** `rgba(255, 255, 255, 0.75)` (浅) / `rgba(15, 23, 42, 0.78)` (深) —— 半透明，后方内容若隐若现
- **Blur:** `backdrop-filter: blur(20px)` —— 梦境玻璃态的核心实现
- **Border:** `1px solid rgba(226, 232, 240, 0.8)` (浅) / `rgba(71, 85, 105, 0.78)` (深) —— 极淡的存在感
- **Shadow:** dream-float（深远、扩散、低透明度）
- **Internal Padding:** 24px（桌面）/ 16px（移动端）

### Inputs / Fields

- **Style:** white bg, 1px border (#e2e8f0), 8px radius, 38px min-height
- **Focus:** border 变为星云紫, 外围 3px focus ring (`rgba(99, 102, 241, 0.12)`)
- **Textarea:** 同上, min-height 80px, 可垂直 resize

### Navigation (Scope List)

侧边栏目标视角列表，作为浮层覆盖在地图左上角。

- **Container:** 水晶面板样式 (blur + 半透明白 + dream-shadow), 216px 宽, 12px radius
- **Item:** 40px min-height, 8px radius, hover 时背景变为 raised surface + 边框显现
- **Active:** 浅紫底 (accent-soft) + 深紫文字
- **Collapsed:** 收缩为 38px 宽的单按钮

### Goalscape 星图 (Signature Component)

整个产品的灵魂组件：SVG 驱动的浮空目标地图。

- **Viewbox:** 1200×760, 宽高比 ≈ 1.58:1
- **节点形态:** 有机 blob 形状 (贝塞尔曲线随机变形的椭圆), 非规则几何
- **进度表达:** 双重系统 —— ① 液面填充 (从下往上的半透明渐变矩形, clip 在 blob 内) ② 星核光芒 (中心圆点, radius 和 filter blur 随进度增长)
- **连接线:** 三层悬索桥 (底层辉光 + 中层细索 + 顶层白色能量粒子流)
- **中心珍珠:** 多层径向渐变 + 虹彩光泽 + 外圈金色星盘齿轮 (120s 匀速旋转)
- **动效:** 节点浮空 (6s ease-in-out 上下 6px) + 能量流 (4s linear dash offset) + 星盘旋转 (120s) + 100% 闪烁 (2.4s)
- **Reduced motion:** 所有 keyframes 全部 `animation: none`

## 6. Do's and Don'ts

### Do:

- **Do** 让节点在静止时保持极轻微的浮动动画（6s 周期，6px 振幅），传递"活着"的感觉
- **Do** 用 `backdrop-filter: blur(20px)` 实现面板的梦境玻璃态；这是系统的视觉锚点
- **Do** 让恒星金 (#f59e0b) 只在目标 100% 完成时出现（土星环 + 十字星爆），保持其稀缺感
- **Do** 所有 transition 使用 `cubic-bezier(0.16, 1, 0.3, 1)`（弹簧式 ease-out），传递轻盈感
- **Do** 深色主题中对 SVG 文字使用 `fill: #000000`（非 ink token），确保珍珠内标签在高光背景上可读
- **Do** 每个动画都有 `@media (prefers-reduced-motion: reduce)` 替代方案

### Don't:

- **Don't** 使用数据仪表盘式的密集图表、进度条、或百分比环形图。这是 Grafana/Datadog 的语言，与"安静仰望"背道而驰（PRODUCT.md 反参考）
- **Don't** 使用白色卡片网格布局（Todoist/Notion 风格）。目标不是"任务"，是"星体"
- **Don't** 使用任何弹跳 (bounce) 或弹性 (elastic) 缓动曲线。所有运动必须是指数衰减式 (ease-out-quart/quint/expo)
- **Don't** 让任何动画周期短于 2 秒。快速闪烁制造焦虑
- **Don't** 把恒星金用作普通警告色或 hover 高亮。它的含义已被绑定：仅代表"完满达成"
- **Don't** 使用 border-left > 1px 的彩色侧条纹作为装饰
- **Don't** 在深色主题中使用纯黑 (#000000) 作为背景。最深值是 #0f172a（深靛蓝），保留一丝色彩温度
- **Don't** 使用渐变文字 (background-clip: text + gradient)
