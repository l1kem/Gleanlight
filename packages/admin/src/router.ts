import { createRouter, createWebHashHistory } from "vue-router";
import { auth, checkAuth } from "./stores/auth";

export const router = createRouter({
  // hash 模式：server 静态托管时无需 SPA fallback 配合（已兼容），且本地文件预览也可用
  history: createWebHashHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/", component: () => import("./views/DashboardView.vue") },
    { path: "/posts", component: () => import("./views/PostsView.vue") },
    { path: "/posts/new", component: () => import("./views/PostEditView.vue") },
    { path: "/posts/:id", component: () => import("./views/PostEditView.vue") },
    { path: "/kb", component: () => import("./views/KbView.vue") },
    { path: "/media", component: () => import("./views/MediaView.vue") },
    { path: "/publish", component: () => import("./views/PublishView.vue") },
    { path: "/settings", component: () => import("./views/SettingsView.vue") },
    { path: "/styleguide", component: () => import("./views/StyleguideView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (!auth.checked) await checkAuth();
  if (!auth.user) return { path: "/login" };
  return true;
});
