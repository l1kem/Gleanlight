<script setup lang="ts">
/**
 * 知识图谱：canvas 力导向（零依赖）。
 * - 布局持久化：首次模拟收敛后存 localStorage，之后打开直接静态呈现（不再晃荡）；
 *   只有新增节点才参与新一轮模拟。
 * - 交互：滚轮以光标为中心缩放；空白处拖拽平移；节点可拖动；点击（非拖动）进编辑页。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

interface GNode {
  id: number;
  slug: string;
  title: string;
  status: string;
  topic_name: string | null;
}
interface GEdge {
  source: number;
  target: number;
}

const router = useRouter();
const canvasEl = ref<HTMLCanvasElement>();
const empty = ref(false);
const LAYOUT_KEY = "kb-graph-layout";

interface SimNode extends GNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean; // 用户拖过/已有布局的节点不动
}

let nodes: SimNode[] = [];
let edges: (GEdge & { s: SimNode; t: SimNode })[] = [];
let raf = 0;
let alpha = 1;
let running = false;
let worldW = 600;
let worldH = 320;

// 视图变换（屏幕 = world * scale + offset）
let scale = 1;
let ox = 0;
let oy = 0;

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function tick(): void {
  const REP = 2600;
  const SPRING = 0.012;
  const GRAV = 0.012;
  const movers = nodes.filter((n) => !n.pinned);
  const all = nodes;
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 1;
      }
      const f = (REP / d2) * alpha;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!a.pinned) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.pinned) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }
  }
  for (const e of edges) {
    const dx = e.t.x - e.s.x;
    const dy = e.t.y - e.s.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const target = Math.min(worldW, worldH) * 0.22;
    const f = (d - target) * SPRING * alpha;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    if (!e.s.pinned) {
      e.s.vx += fx;
      e.s.vy += fy;
    }
    if (!e.t.pinned) {
      e.t.vx -= fx;
      e.t.vy -= fy;
    }
  }
  for (const n of movers) {
    n.vx += (worldW / 2 - n.x) * GRAV * alpha;
    n.vy += (worldH / 2 - n.y) * GRAV * alpha;
    n.vx *= 0.85;
    n.vy *= 0.85;
    n.x += n.vx;
    n.y += n.vy;
    n.x = Math.max(24, Math.min(worldW - 24, n.x));
    n.y = Math.max(18, Math.min(worldH - 18, n.y));
  }
  alpha *= 0.995;
}

function nodeR(n: SimNode): number {
  return 5 + Math.min(4, edges.filter((e) => e.s === n || e.t === n).length);
}

function draw(): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rule = cssVar("--color-rule-strong");
  const accent = cssVar("--color-accent");
  const ink = cssVar("--color-ink-strong");
  const neutral = cssVar("--color-neutral");
  const paper = cssVar("--color-paper");

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  ctx.strokeStyle = rule;
  ctx.lineWidth = 1 / scale;
  ctx.globalAlpha = 0.7;
  for (const e of edges) {
    ctx.beginPath();
    ctx.moveTo(e.s.x, e.s.y);
    ctx.lineTo(e.t.x, e.t.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  for (const n of nodes) {
    const r = nodeR(n);
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    if (n.status === "published") {
      ctx.fillStyle = accent;
      ctx.fill();
    } else {
      ctx.fillStyle = paper;
      ctx.fill();
      ctx.strokeStyle = neutral;
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
    }
    const label = n.title.length > 10 ? `${n.title.slice(0, 9)}…` : n.title;
    ctx.font = `${11 / scale}px sans-serif`;
    ctx.fillStyle = ink;
    ctx.fillText(label, n.x, n.y + r + 12 / scale);
  }
  ctx.restore();
}

function saveLayout(): void {
  try {
    const layout: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) layout[String(n.id)] = { x: Math.round(n.x), y: Math.round(n.y) };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* 存储失败不影响使用 */
  }
}

function loop(): void {
  tick();
  draw();
  if (alpha > 0.05) {
    raf = requestAnimationFrame(loop);
  } else {
    running = false;
    saveLayout(); // 收敛后固化布局，下次打开不再晃
  }
}

function startSim(): void {
  if (running) return;
  running = true;
  alpha = 1;
  raf = requestAnimationFrame(loop);
}

// ── 交互：滚轮缩放 / 拖拽平移 / 节点拖动 / 点击进入 ────────────
function toWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - ox) / scale, y: (sy - oy) / scale };
}

function nodeAtWorld(x: number, y: number): SimNode | undefined {
  return nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 14);
}

let dragState:
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "node"; node: SimNode; sx: number; sy: number; moved: boolean }
  | null = null;

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const canvas = canvasEl.value!;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const next = Math.max(0.3, Math.min(4, scale * factor));
  // 以光标为锚点缩放
  ox = sx - ((sx - ox) / scale) * next;
  oy = sy - ((sy - oy) / scale) * next;
  scale = next;
  draw();
}

function onPointerDown(e: PointerEvent): void {
  const canvas = canvasEl.value!;
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
  const hit = nodeAtWorld(w.x, w.y);
  if (hit) {
    dragState = { kind: "node", node: hit, sx: e.clientX, sy: e.clientY, moved: false };
    hit.pinned = true;
  } else {
    dragState = { kind: "pan", sx: e.clientX, sy: e.clientY, ox, oy };
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!dragState) {
    const canvas = canvasEl.value!;
    const rect = canvas.getBoundingClientRect();
    const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    canvas.style.cursor = nodeAtWorld(w.x, w.y) ? "pointer" : "grab";
    return;
  }
  const dx = e.clientX - dragState.sx;
  const dy = e.clientY - dragState.sy;
  if (dragState.kind === "pan") {
    ox = dragState.ox + dx;
    oy = dragState.oy + dy;
  } else {
    if (Math.hypot(dx, dy) > 3) dragState.moved = true;
    const w = toWorld(e.clientX - (canvasEl.value!.getBoundingClientRect().left), e.clientY - (canvasEl.value!.getBoundingClientRect().top));
    dragState.node.x = w.x;
    dragState.node.y = w.y;
    dragState.node.vx = 0;
    dragState.node.vy = 0;
  }
  draw();
}

function onPointerUp(): void {
  if (!dragState) return;
  if (dragState.kind === "node") {
    if (!dragState.moved) {
      void router.push(`/posts/${dragState.node.id}`); // 点击（非拖动）→ 编辑页
    } else {
      saveLayout(); // 拖完固化
      startSim(); // 让邻居松弛一下
    }
  }
  dragState = null;
}

function fitView(): void {
  const canvas = canvasEl.value;
  if (!canvas || nodes.length === 0) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const pad = 60;
  scale = Math.max(
    0.3,
    Math.min(4, Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY)))
  );
  ox = w / 2 - ((minX + maxX) / 2) * scale;
  oy = h / 2 - ((minY + maxY) / 2) * scale;
}

function cleanup(): void {
  const canvas = canvasEl.value;
  if (!canvas) return;
  canvas.removeEventListener("wheel", onWheel);
  canvas.removeEventListener("pointerdown", onPointerDown);
  canvas.removeEventListener("pointermove", onPointerMove);
  canvas.removeEventListener("pointerup", onPointerUp);
}

onMounted(async () => {
  const g = await api.get<{ nodes: GNode[]; edges: GEdge[] }>("/kb/graph");
  empty.value = g.nodes.length === 0;
  const canvas = canvasEl.value;
  if (!canvas || empty.value) return;
  worldW = canvas.clientWidth || 600;
  worldH = canvas.clientHeight || 320;

  // 恢复持久化布局；没有缓存的新节点才参与模拟
  let layout: Record<string, { x: number; y: number }> = {};
  try {
    layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
  } catch {
    layout = {};
  }
  let fresh = 0;
  nodes = g.nodes.map((n, i) => {
    const cached = layout[String(n.id)];
    if (cached) {
      return { ...n, x: cached.x, y: cached.y, vx: 0, vy: 0, pinned: true };
    }
    fresh += 1;
    const angle = (i / Math.max(1, g.nodes.length)) * Math.PI * 2;
    return {
      ...n,
      x: worldW / 2 + Math.cos(angle) * (Math.min(worldW, worldH) * 0.3),
      y: worldH / 2 + Math.sin(angle) * (Math.min(worldW, worldH) * 0.3),
      vx: 0,
      vy: 0,
      pinned: false,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  edges = g.edges
    .map((e) => ({ ...e, s: byId.get(e.source)!, t: byId.get(e.target)! }))
    .filter((e) => e.s && e.t);

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.style.cursor = "grab";

  if (fresh === 0) {
    // 全部有缓存：直接静态呈现 + 适配视口
    fitView();
    draw();
  } else {
    if (reduced) {
      alpha = 1;
      for (let i = 0; i < 160; i++) tick();
      saveLayout();
      fitView();
      draw();
    } else {
      fitView();
      startSim();
    }
  }
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  cleanup();
});
</script>

<template>
  <div class="graph">
    <canvas ref="canvasEl" class="graph__canvas" aria-label="知识关联图谱（滚轮缩放，拖拽平移，点击节点进入编辑）" role="img"></canvas>
    <p v-if="empty" class="graph__empty muted small">还没有文章节点——写下第一篇并用 [[ ]] 互链后，这里会长出图谱。</p>
    <p class="graph__legend muted small">
      <span class="graph__dot graph__dot--pub"></span>已发布
      <span class="graph__dot graph__dot--draft"></span>草稿
      · 连线 = [[ 双向链接 ]]
      · 滚轮缩放 / 拖动平移 / 拖节点 / 单击进入编辑 · 布局自动记忆
    </p>
  </div>
</template>

<style scoped>
.graph {
  position: relative;
}
.graph__canvas {
  width: 100%;
  height: 22rem;
  display: block;
  touch-action: none;
}
.graph__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.graph__legend {
  margin: var(--space-xs) 0 0;
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-wrap: wrap;
}
.graph__dot {
  display: inline-block;
  width: 0.6em;
  height: 0.6em;
  border-radius: 50%;
  margin-left: var(--space-xs);
}
.graph__dot--pub {
  background: var(--color-accent);
}
.graph__dot--draft {
  border: 1.5px solid var(--color-neutral);
}
</style>
