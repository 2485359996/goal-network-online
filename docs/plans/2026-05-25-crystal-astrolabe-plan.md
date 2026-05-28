# Crystal Astrolabe Map Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the Goal Network frontend map into a stunning "Crystal Astrolabe Floating Islands" system with beautiful particle-like energy flows, glass-morphic suspension bridges, glowing starlight cores, and Saturn-like golden ring achievements, while keeping all functional API logic and pointer dragging intact.

**Architecture:** We will modify the client UI layers in `.goal-network-app/src/client/main.tsx` and `.goal-network-app/src/client/styles.css`. We will also update `.goal-network-app/src/client/goalscapeLayout.test.ts` to test our new visual helpers instead of the removed liquid helpers.

**Tech Stack:** React 19, SVG, CSS Keyframes, CSS Filters.

---

## Tasks

### Task 1: Update CSS Rules with Astrolabe Elements and Decoupled Floating
**Objective:** Add CSS classes for dynamic极光 (realm auoras), rotating lighthouse rays, suspension bridges with pulsing dashed offset animations, and decoupled island floatings.

**Files:**
- Modify: `.goal-network-app/src/client/styles.css`
- Test: Run Vite build or dev to check syntax

**Steps:**
1. Open `styles.css`.
2. Locate and remove old styling rules for `.goalscape-node-liquid`, `.goalscape-node-liquid-surface`, etc.
3. Add `@keyframes` for `aurora-realm`, `light-sweep`, `flowing-energy`, `float-island`, `pulse-star`, and `rot-astrolabe`.
4. Style the inline backdrop elements: `.goalscape-backdrop-aurora`, `.goalscape-lighthouse-ray`, `.goalscape-sailing-boat`.
5. Style the bridges: `.goalscape-bridge-glow`, `.goalscape-bridge-laser`, `.goalscape-bridge-cables`.
6. Style the decoupled node visual container: `.goalscape-node-visual` handles the `float-island` animation.
7. Disable animations when dragging or when user prefers reduced motion:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .goalscape-node-visual, .goalscape-bridge-laser, .goalscape-lighthouse-ray {
       animation: none !important;
     }
   }
   .goalscape-node.dragging .goalscape-node-visual {
     animation: none !important;
   }
   ```

---

### Task 2: Implement Inline Backdrop Component (GoalMapBackdrop)
**Objective:** Extract backdrop geometry from `goalscape-backdrop.svg` and create a clean inner inline React component to prevent misalignment and support CSS classes and custom animations.

**Files:**
- Modify: `.goal-network-app/src/client/main.tsx`
- Test: Run dev server and confirm background scales 100% perfectly with Viewbox

**Steps:**
1. Open `.goal-network-app/src/client/main.tsx`.
2. Declare `GoalMapBackdrop` component containing:
   - The feathered auroras (purple for Growth, green for Life, blue for Career/Extra).
   - The astronomical grids and guiding rays.
   - The tiny sailboat with a small bobbing animation.
   - The rotating lighthouse yellow beam (anchored on coordinates `(1028, 349)`).
3. Search `styles.css` and delete the old background image rule under `.map-pane::before`.
4. In `GoalMap`, place `<GoalMapBackdrop />` as the very first child inside the `<svg>` tag.

---

### Task 3: Extract Suspended Bridges Component (GoalscapeBridge)
**Objective:** Create a dedicated modular `GoalscapeBridge` React component that draws the deck curve, the suspension cables, and the foreground flowing white star pulses.

**Files:**
- Modify: `.goal-network-app/src/client/main.tsx`
- Test: Ensure connections show beautifully in dev server

**Steps:**
1. In `main.tsx`, define a clean functional component `GoalscapeBridge`:
   ```typescript
   function GoalscapeBridge({
     from,
     to,
     id,
     color
   }: {
     from: { x: number; y: number };
     to: { x: number; y: number };
     id: string;
     color: string;
   }) {
     const d = goalscapeConnectionPath(from, to);
     // Calculate upper cable deck curves for suspension arches
     const midX = (from.x + to.x) / 2;
     const midY = (from.y + to.y) / 2;
     const dArch = `M ${from.x} ${from.y} C ${midX} ${from.y - 18}, ${midX} ${midY - 18}, ${to.x} ${to.y}`;
     
     return (
       <g key={id} className="goalscape-bridge-group">
         {/* 1. Underlying soft glass glow base */}
         <path d={d} className="goalscape-bridge-glow" stroke={color} strokeWidth="5.5" />
         {/* 2. Parallel upper suspended arch cable */}
         <path d={dArch} className="goalscape-bridge-glow" stroke={color} strokeWidth="1.2" opacity="0.6" />
         {/* 3. Vertical tension cable hangers (using fine stroke dashed pattern) */}
         <path d={d} className="goalscape-bridge-cables" strokeWidth="0.8" />
         {/* 4. White flowing star prism dash array overlay */}
         <path d={d} className="goalscape-bridge-laser" strokeWidth="1.5" />
       </g>
     );
   }
   ```
2. In `GoalMap`, replace the old loops inside `<g className="goalscape-connections">` with `<GoalscapeBridge />` components mapping over topLayouts and childLayouts.

---

### Task 4: Upgrade Floating Nodes, Starlight Cores and Saturn Rings
**Objective:** Refactor the node layout loop to support: decoupled visual groups, progress-based opacity scale for crystal hulls, glowing starlight cores, and achievements Saturn gold rings.

**Files:**
- Modify: `.goal-network-app/src/client/main.tsx`
- Test: Confirm cores, transparency, and rings are fully responsive to node progress values

**Steps:**
1. Define helpers `goalscapeNodeDensity(progress)` and `goalscapeStarlightCoreRadius(baseRadius, progress)` inside `main.tsx`:
   ```typescript
   export function goalscapeNodeDensity(progress: number) {
     return 0.12 + 0.68 * (clamp(progress, 0, 100) / 100);
   }

   export function goalscapeStarlightCoreRadius(baseRadius: number, progress: number) {
     return baseRadius * (0.2 + 0.8 * (clamp(progress, 0, 100) / 100));
   }
   ```
2. Locate the node loop `layouts.map((layout, index) => { ... })` inside `GoalMap`.
3. Wrap all visual elements (`.goalscape-node-halo`, `.goalscape-node-shape`, icons, labels) into an inner `<g className="goalscape-node-visual" style={{ animationDelay: `${-index * 0.7}s` }}>`.
4. Remove wave-liquid drawings. Set `.goalscape-node-shape` fill opacity using `goalscapeNodeDensity(layout.progress)`.
5. Render the starlight core inside `<g className="goalscape-node-visual">`:
   ```typescript
   <circle
     cx={layout.x}
     cy={layout.y}
     r={goalscapeStarlightCoreRadius(layout.depth === 1 ? 16 : 10, layout.progress)}
     className="goal-starlight-core"
     fill={layout.color}
     filter={`url(#goalscape-glow-level-${Math.min(5, Math.floor(layout.progress / 20))})`}
   />
   ```
6. Add Saturn Gold ring & four-cornered shimmer star if `layout.progress === 100`.

---

### Task 5: Refactor Defs & Celestial Pearl Center
**Objective:** Declare the core astrolabe filters inside SVG `<defs>` and render the beautiful high-gloss Celestial Pearl and rotating astronomical gear in the center.

**Files:**
- Modify: `.goal-network-app/src/client/main.tsx`
- Test: Dev server loads with zero console warnings

**Steps:**
1. Expand `<defs>` in `GoalMap` to declare:
   - Filters `goalscape-glow-level-0` to `goalscape-glow-level-5` using `feGaussianBlur` values from 1 to 14.
   - Radial gradients for the starlight cores.
   - Core pearl metal gradient `goalscape-pearl-metallic`.
2. Rewrite the central root node `.goalscape-center` rendering:
   - Add a background gear ring `<g className="goalscape-center-astrolabe">` displaying a rotating star disk.
   - Add the multi-layered high-light sphere representing the Pearl.

---

### Task 6: Repair layout test suite and build verification
**Objective:** Update the layout test suite to assert the new density and core radius logic, run unit tests, and perform final production build checks.

**Files:**
- Modify: `.goal-network-app/src/client/goalscapeLayout.test.ts`
- Test: Run `npm test` and `npm run build` to verify perfect compilation and green tests

**Steps:**
1. Open `.goal-network-app/src/client/goalscapeLayout.test.ts`.
2. Delete the test block for `"maps progress to liquid amount instead of color depth"`.
3. Add new assertions verifying `goalscapeNodeDensity` and `goalscapeStarlightCoreRadius` bounds and values.
4. Run `npm test` in the terminal to ensure all tests pass.
5. Run `npm run build` to verify production compiler is error-free.
