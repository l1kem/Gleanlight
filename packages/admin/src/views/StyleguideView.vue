<script setup lang="ts">
/**
 * 活样式字典：后台所有基元组件与令牌的唯一展示窗口。
 * 新界面从这里拷贝；新组件必须先在这里登记。
 */
import { ref } from "vue";
import AppSelect from "../components/AppSelect.vue";
import { icons } from "../icons";

const demoSelect = ref("b");
const selectOptions = [
  { value: "a", label: "选项一" },
  { value: "b", label: "选项二" },
  { value: "c", label: "选项三", group: "分组丙" },
  { value: "d", label: "选项四", group: "分组丙" },
];
const demoInput = ref("");
const demoCheck = ref(true);
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>样式字典</h1>
      <p class="muted small">Gleanlight 后台设计系统 · 色彩跟前台手帐（米纸 / 深棕墨 / 砖红）</p>
    </header>

    <section class="panel">
      <h2>色彩令牌</h2>
      <div class="swatches">
        <div v-for="(c, i) in [
          ['--color-paper', '纸面'], ['--color-paper-2', '卡片'], ['--color-paper-3', '压暗'],
          ['--color-accent', '砖红'], ['--color-ink', '墨色'], ['--color-neutral', '灰墨'],
          ['--color-success', '苔绿'], ['--color-danger', '朱砂警示'],
        ]" :key="i" class="swatch">
          <span class="swatch__chip" :style="{ background: `var(${c[0]})` }" />
          <span class="small">{{ c[1] }}</span>
          <code class="muted tiny">{{ c[0] }}</code>
        </div>
      </div>
      <p class="muted small">深浅色跟随 <code>data-theme</code>；组件只许引用令牌，禁止裸色值。</p>
    </section>

    <section class="panel">
      <h2>图标</h2>
      <p class="muted small">1.7px 圆头描边，统一取自 <code>src/icons.ts</code>。</p>
      <div class="icon-grid">
        <span v-for="(path, name) in icons" :key="name" class="icon-cell" :title="name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="path" />
          </svg>
        </span>
      </div>
    </section>

    <section class="panel">
      <h2>按钮</h2>
      <div class="row">
        <button class="btn btn-primary" type="button">主要操作</button>
        <button class="btn" type="button">次要操作</button>
        <button class="btn btn-danger" type="button">危险操作</button>
        <button class="btn btn-sm" type="button">小按钮</button>
        <button class="btn" type="button" disabled>禁用态</button>
      </div>
    </section>

    <section class="panel">
      <h2>表单</h2>
      <div class="row wrap">
        <div class="field" style="max-width: 16rem">
          <label>输入框</label>
          <input v-model="demoInput" class="input" type="text" placeholder="占位文字" />
        </div>
        <div class="field" style="max-width: 16rem">
          <label>下拉（自绘，含分组）</label>
          <AppSelect v-model="demoSelect" :options="selectOptions" />
        </div>
        <div class="field" style="max-width: 16rem">
          <label>多行文本</label>
          <textarea class="textarea" rows="2" placeholder="textarea"></textarea>
        </div>
        <label class="check-row">
          <input v-model="demoCheck" type="checkbox" />
          <span>复选框</span>
        </label>
      </div>
    </section>

    <section class="panel">
      <h2>徽标 / 标签</h2>
      <div class="row">
        <span class="badge">中性</span>
        <span class="badge badge-published">已发布</span>
        <span class="badge badge-draft">草稿</span>
        <span class="badge badge-featured">精选</span>
        <span class="tag">标签</span>
        <span class="mono">等宽 JetBrains Mono</span>
      </div>
    </section>

    <section class="panel">
      <h2>表格</h2>
      <table class="table">
        <thead>
          <tr><th>列一</th><th>列二</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr><td>样例行</td><td class="muted small">说明文字</td><td><button class="btn btn-sm" type="button">按钮</button></td></tr>
          <tr><td>悬停整行变暗</td><td class="muted small">paper-3 半透明</td><td><button class="btn btn-sm btn-danger" type="button">删除</button></td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>空态</h2>
      <div class="empty">
        <p class="empty__title">这里还空着</p>
        <p class="muted small">空态 = 一句话 + 引导动作；不许白板吓人。</p>
        <button class="btn btn-sm btn-primary" type="button">开始行动</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.row.wrap { flex-wrap: wrap; align-items: flex-end; }
.swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: var(--space-sm);
}
.swatch {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}
.swatch__chip {
  height: 3rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-rule);
}
.tiny { font-size: 0.7rem; }
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
  gap: var(--space-2xs);
}
.icon-cell {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  color: var(--color-muted);
  background: var(--color-paper-3);
  border-radius: var(--radius-sm);
}
.icon-cell svg { width: 1.25rem; height: 1.25rem; }
</style>
