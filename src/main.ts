import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

/** 云 init 改在 App.vue onLaunch 首行调用，避免 app 入口与 wx 运行时竞态导致开发者工具内 Error: timeout */

export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  return { app };
}
