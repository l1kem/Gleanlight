import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "@gleanlight/tokens/tokens.css";
import "vditor/dist/index.css";
import "./styles/base.css";
import "./styles/vditor-theme.css";

createApp(App).use(router).mount("#app");
