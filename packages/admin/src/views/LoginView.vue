<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { login } from "../stores/auth";
import { toastError } from "../toast";

const router = useRouter();
const form = reactive({ username: "", password: "" });
const loading = ref(false);
const error = ref("");

async function submit(): Promise<void> {
  if (!form.username || !form.password) {
    error.value = "请输入用户名和密码";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    await login(form.username, form.password);
    router.replace("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "登录失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="submit">
      <h1 class="login__mast">书房</h1>
      <p class="login__sub">Gleanlight 后台 · 仅限本人</p>
      <div class="field">
        <label for="username">用户名</label>
        <input
          id="username"
          v-model="form.username"
          class="input"
          type="text"
          autocomplete="username"
          autocapitalize="none"
        />
      </div>
      <div class="field">
        <label for="password">密码</label>
        <input
          id="password"
          v-model="form.password"
          class="input"
          type="password"
          autocomplete="current-password"
        />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn btn-primary login__btn" type="submit" :data-loading="loading">
        {{ loading ? "正在进入…" : "进入书房" }}
      </button>
      <p class="login__hint">连续失败 5 次将被锁定 15 分钟</p>
    </form>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-lg);
  background: var(--color-paper-2);
}
.login__card {
  width: min(24rem, 100%);
  background: var(--color-paper);
  border: 1px solid var(--color-rule);
  border-top: 3px double var(--color-rule-strong);
  padding: var(--space-2xl) var(--space-2xl);
}
.login__mast {
  font-size: var(--text-3xl);
  text-align: center;
  margin: 0;
}
.login__sub {
  text-align: center;
  color: var(--color-neutral);
  font-size: var(--text-sm);
  letter-spacing: 0.2em;
  margin: var(--space-xs) 0 var(--space-2xl);
}
.login__btn {
  width: 100%;
  justify-content: center;
  padding: var(--space-md);
  font-size: var(--text-md);
}
.login__hint {
  margin-top: var(--space-lg);
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-neutral);
}
</style>
