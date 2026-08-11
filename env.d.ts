/// <reference types="vite/client" />
/// <reference types="@dcloudio/types" />

interface ImportMetaEnv {
  readonly VITE_WX_CLOUD_ENV_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '@/manifest.json' {
  const manifest: {
    name?: string
    versionName?: string
    versionCode?: string
    [key: string]: unknown
  }
  export default manifest
}
