import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:7300",
      "/media": "http://127.0.0.1:7300",
      "/uploads": "http://127.0.0.1:7300",
    },
  },
});
