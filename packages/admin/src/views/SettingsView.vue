<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api } from "../api";
import { toast, toastError } from "../toast";

interface SettingsPayload {
  site: {
    title: string;
    description: string;
    author: string;
    avatar: string;
    mastheadIntro: string;
    footerNote: string;
    social: { label: string; url: string }[];
    skin?: string;
  };
  ai: { baseUrl: string; model: string; apiKey: string; hasKey: boolean };
  publish: { adapter: string; localDir: string };
}

const site = reactive<SettingsPayload["site"]>({
  title: "",
  description: "",
  author: "",
  avatar: "",
  mastheadIntro: "",
  footerNote: "",
  social: [],
  skin: "journal",
});
const ai = reactive<SettingsPayload["ai"]>({ baseUrl: "", model: "", apiKey: "", hasKey: false });
const publish = reactive<SettingsPayload["publish"]>({ adapter: "local", localDir: "" });
const pwd = reactive({ oldPassword: "", newPassword: "" });
const savingSite = ref(false);
const savingAi = ref(false);
const testing = ref(false);
const savingPwd = ref(false);

onMounted(async () => {
  const s = await api.get<SettingsPayload>("/settings");
  Object.assign(site, s.site);
  Object.assign(ai, s.ai, { apiKey: "" });
  Object.assign(publish, s.publish);
});

async function saveSite(): Promise<void> {
  savingSite.value = true;
  try {
    await api.put("/settings", { site });
    toast("站点设置已保存，重新发布后前台生效", "success");
  } catch (err) {
    toastError(err);
  } finally {
    savingSite.value = false;
  }
}
async function saveAi(): Promise<void> {
  savingAi.value = true;
  try {
    await api.put("/settings", { ai });
    ai.apiKey = "";
    const s = await api.get<SettingsPayload>("/settings");
    ai.hasKey = s.ai.hasKey;
    toast("AI 配置已保存", "success");
  } catch (err) {
    toastError(err);
  } finally {
    savingAi.value = false;
  }
}
async function testAi(): Promise<void> {
  testing.value = true;
  try {
    const r = await api.post<{ ok: boolean; sample?: string; error?: string }>("/ai/test");
    toast(r.ok ? `连通正常：${r.sample ?? ""}` : `失败：${r.error}`, r.ok ? "success" : "error");
  } catch (err) {
    toastError(err);
  } finally {
    testing.value = false;
  }
}
async function savePwd(): Promise<void> {
  savingPwd.value = true;
  try {
    await api.put("/settings/password", pwd);
    pwd.oldPassword = "";
    pwd.newPassword = "";
    toast("密码已修改", "success");
  } catch (err) {
    toastError(err);
  } finally {
    savingPwd.value = false;
  }
}

function addSocial(): void {
  site.social.push({ label: "", url: "" });
}
</script>

<template>
  <div class="page">
    <header class="page-head"><h1>设置</h1></header>

    <section class="panel">
      <h2>站点</h2>
      <div class="grid-2">
        <div class="field">
          <label for="s-title">站名</label>
          <input id="s-title" v-model="site.title" class="input" type="text" />
        </div>
        <div class="field">
          <label for="s-author">作者</label>
          <input id="s-author" v-model="site.author" class="input" type="text" />
        </div>
      </div>
      <div class="field">
        <label for="s-desc">一句话简介（SEO）</label>
        <input id="s-desc" v-model="site.description" class="input" type="text" />
      </div>
      <div class="field">
        <label for="s-intro">刊头自介（首页刊头下那行字）</label>
        <input id="s-intro" v-model="site.mastheadIntro" class="input" type="text" />
      </div>
      <div class="field">
        <label for="s-footer">页脚落款</label>
        <input id="s-footer" v-model="site.footerNote" class="input" type="text" />
      </div>
      <div class="field">
        <label>社交链接</label>
        <div v-for="(s, i) in site.social" :key="i" class="social-row">
          <input v-model="s.label" class="input" type="text" placeholder="名称" />
          <input v-model="s.url" class="input" type="url" placeholder="https://" />
          <button class="btn btn-sm btn-danger" type="button" @click="site.social.splice(i, 1)">删</button>
        </div>
        <button class="btn btn-sm" type="button" @click="addSocial">+ 添加</button>
      </div>
      <div class="field">
        <label for="s-skin">默认界面风格</label>
        <select id="s-skin" v-model="site.skin" class="select">
          <option value="journal">手帐（米黄纸 · 文楷 · 砖红）</option>
          <option value="moss">溪石（米纸 · 苔绿 · 陶土 · 有机圆角）</option>
        </select>
        <span class="hint">访客默认看到的风格；访客可在前台右上角自行切换（只记在自己的浏览器里）</span>
      </div>
      <button class="btn" type="button" :data-loading="savingSite" @click="saveSite">保存站点设置</button>
    </section>

    <section class="panel">
      <h2>AI 模型</h2>
      <p class="muted small">OpenAI 兼容协议；GLM / DeepSeek / OpenAI 等均可。密钥只存在本地数据库。</p>
      <div class="grid-2">
        <div class="field">
          <label for="ai-base">Base URL</label>
          <input id="ai-base" v-model="ai.baseUrl" class="input mono" type="url" placeholder="https://open.bigmodel.cn/api/paas/v4" />
        </div>
        <div class="field">
          <label for="ai-model">模型</label>
          <input id="ai-model" v-model="ai.model" class="input mono" type="text" placeholder="glm-4.7" />
        </div>
      </div>
      <div class="field">
        <label for="ai-key">API Key {{ ai.hasKey ? "（已配置，留空不修改）" : "" }}</label>
        <input id="ai-key" v-model="ai.apiKey" class="input mono" type="password" autocomplete="new-password" />
      </div>
      <div class="actions-row">
        <button class="btn" type="button" :data-loading="savingAi" @click="saveAi">保存</button>
        <button class="btn" type="button" :data-loading="testing" @click="testAi">测试连通</button>
      </div>
    </section>

    <section class="panel">
      <h2>修改密码</h2>
      <div class="grid-2">
        <div class="field">
          <label for="p-old">原密码</label>
          <input id="p-old" v-model="pwd.oldPassword" class="input" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label for="p-new">新密码（≥8 位）</label>
          <input id="p-new" v-model="pwd.newPassword" class="input" type="password" autocomplete="new-password" />
        </div>
      </div>
      <button class="btn" type="button" :data-loading="savingPwd" @click="savePwd">修改密码</button>
    </section>
  </div>
</template>

<style scoped>
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 var(--space-lg);
}
@media (max-width: 40rem) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
.social-row {
  display: grid;
  grid-template-columns: 8rem 1fr auto;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}
.actions-row {
  display: flex;
  gap: var(--space-sm);
}
</style>
