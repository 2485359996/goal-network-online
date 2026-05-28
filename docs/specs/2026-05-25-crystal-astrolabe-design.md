# 目标网络前端地图「精雕水晶星盘」视觉大修设计书

## 1. 概述
本设计方案旨在将现有的“瓶中之水”目标地图大修升级为具有**梦幻浮空岛屿（Floating Island）、水晶玻璃态（Glassmorphism）与天体星盘（Celestial Astrolabe）**的极高品质视觉效果。
此升级将 100% 保持当前系统中的：
- 拖拽与坐标定位逻辑（位置数据同步到 md frontmatter 中的位置映射）。
- 鼠标点击选择、双击下钻到子视图、双击中心返回上级的交互。
- 所有数据接口、组件内部方法、目标分类逻辑。

---

## 2. 详细设计规格 (Design Spec)

### 2.1 同心天文星盘内联背景 (The Inline Astrolabe Backdrop)
为解决外部 SVG 引用导致其内部元素（如旋转灯塔、海流、星梭等）无法通过外部 `styles.css` 类选择器动画化，以及在不同屏幕比例下缩放拉伸不一致的问题：
- **全面内联 React SVG 化 (Inline Backdrop Component)**：
  - 将 `goalscape-backdrop.svg` 里的底层路径（如软模糊色块、极光领地、同心虚线、灯塔及帆船）提取并作为 `GoalMapBackdrop` 组件直接内联在 React 的 `<svg viewBox="0 0 1200 760">` 最底层。
  - 原本在 `styles.css` 中配置在 `.map-pane::before` 下的 `background-image: url("./assets/goalscape-backdrop.svg")` 彻底废弃，实现全自适应矢量比例尺对齐。
- **动态极光领地 (Realm Aurora)**：
  - 对幸福生活（绿 `#a7f3d0`）、个人成长（紫 `#ddd6fe`）、职业发展（蓝 `#bae6fd`）使用高斯模糊羽化度并绑定 CSS `@keyframes aurora` 做出极慢的呼吸式漂移与亮度起伏（18s ~ 24s 周期）。
- **微动小彩蛋 (Micro-animations)**：
  - **旋转灯塔 (Lighthouse Ray)**：在 React 中内联灯塔，其顶尖黄色探照光柱绑定 CSS 旋转动画，实现 15s 周期慢速 360° 旋转。
  - **浮空航船 (Sailing Boat)**：在背景轨道上放置一艘矢量帆船，配合 CSS 进行小幅度的呼吸式起伏与轻微摇晃。

### 2.2 模块化能量悬索桥组件 (GoalscapeBridge Component)
为避免在 `GoalMap` 循环中堆叠大段重复的 JSX 代码并提升渲染性能，我们将连接线抽取为独立的 `GoalscapeBridge` 细粒度组件：
- **悬索主索与拉吊细节 (Suspension Bridge & Tension Hangers)**：
  - 通过 endpoints `from` 和 `to` 绘制标准的 Cubic Bezier 曲梁线 `d` 代表桥面。
  - 动态计算主拉索曲线 `dArch`，即使用相同的 control points 但垂直向上偏移高度 $H$（如 15px ~ 20px）。这完美还原了拱悬索吊桥的宏伟物理轮廓。
- **星梭能量流 (Flowing Energy Stream)**：
  - 在主索/桥面上贴一层白色虚线：`className="goalscape-bridge-laser"`，`stroke-dasharray="6, 18"`。
  - 利用 CSS 调节 `stroke-dashoffset`（渐变递减），视觉上呈现如极光流星般从中心珍珠往外围岛屿动态输送能量的震撼效果。

### 2.3 隔离式水晶岛屿与星核 (The Isolated Floating Nodes & Progress C)
为彻底杜绝浮空动画与 hover、拖拽在 `.goalscape-node` 节点本身上的 `transform` 冲突：
- **外层交互与内层动画完美解耦 (Visual Shell Isolation)**：
  - 外层 `<g className="goalscape-node" ...>` 只保留 hover 放大手势、pointerDrag 事件、双击回调等原始物理手势。
  - 内部嵌套 `<g className="goalscape-node-visual">` 专门承载 CSS 的 `@keyframes float-island` 浮动动画，赋予其自然的高低起伏。
  - 在 `.goalscape-node.dragging .goalscape-node-visual`（正在拖拽）时，以及在 `prefers-reduced-motion` 媒体查询下，**强制通过 CSS 关闭浮空动画**。
- **凝实度 (Density) 与发光星核 (Starlight Core) 插值**：
  - 剔除 wave 高度和 liquidGeometry，改为：
    - `goalscapeNodeDensity(progress)`: 输出 $0.12 + 0.68 \times (progress / 100)$ 的玻璃材质填充不透明度。
    - `goalscapeStarlightCoreRadius(baseRadius, progress)`: 核心星光圆核的半径按进度比进行插值放大，且在不同区间（如 $20\%, 40\%, 60\%, 80\%, 100\%$）应用不同模糊度的 Glow SVG Filters。
- **100% 达成状态：超新星金环 (Saturn Gold Ring & Shimmer Star)**：
  - 达标节点上方绘制倾斜 $15^\circ$ 的金色 Saturn Ring（土星环）以及中心发光的白金十字星爆，表现该目标圆满凝聚。

### 2.4 璀璨珍珠中心点 (The Celestial Pearl Center)
- 将中央的根目标节点重绘为多层径向渐变、带有极致球形光泽的高光珍珠。
- 珍珠边缘环绕一个半透明、带有符文/星盘刻度的小型金色齿轮盘，并以每 45s 一圈的极慢速度顺时针旋转。

---

## 3. 详细设计自评与验证

### 3.1 兼容性与性能
- **DOM / React 状态兼容性**：
  - `layouts` 节点的 `x, y, width, height, node, progress` 字段和原来的完全一致，拖拽手势完好无损。
- **单元测试不破损保护**：
  - 测试用例 `goalscapeLayout.test.ts` 中针对已移除的 `goalscapeLiquidGeometry`，我们将编写替代用例来分别对 `goalscapeNodeDensity` 与 `goalscapeStarlightCoreRadius` 做数学范围断言，确保 `npm test` 100% 跑通。
- **性能与调试**：
  - 利用 CSS `will-change: transform` 保证 30+ 动画元素同时在场时依然能够稳定 60 FPS。
  - 调试和构建一律通过标准的 `npm run build` 进行生产编译测试，不依赖 ReadLints，采用严谨的宿主开发流程。

---

## 4. 下一步计划
在用户批准本规格书后，我们将通过 `writing-plans` 技能建立细致、无损的实施计划，逐步推进样式表 `styles.css` 和组件 `main.tsx` 以及背景矢量资源 `goalscape-backdrop.svg` 的修改。
