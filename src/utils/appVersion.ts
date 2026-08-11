import manifest from '@/manifest.json';

/** Single source: src/manifest.json versionName / versionCode */
export const APP_VERSION_NAME = String(manifest.versionName ?? '');
export const APP_VERSION_CODE = String(manifest.versionCode ?? '');
