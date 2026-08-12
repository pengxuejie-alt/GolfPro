/**
 * 微信上传云函数时只打包各函数目录，不会带上 ../common/。
 * 将 common 模块同步到各云函数目录内，避免体验版/真机 callFunction 失败。
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function syncCommonModule(moduleFileName, targetFunctionNames) {
  const src = path.join(root, 'cloudfunctions', 'common', moduleFileName);
  if (!existsSync(src)) {
    console.error('[sync-cloud-common] missing', src);
    process.exit(1);
  }
  for (const name of targetFunctionNames) {
    const dir = path.join(root, 'cloudfunctions', name);
    if (!existsSync(dir)) {
      console.warn('[sync-cloud-common] skip missing dir', name);
      continue;
    }
    const dest = path.join(dir, moduleFileName);
    cpSync(src, dest);
    console.info('[sync-cloud-common]', name, '← common/' + moduleFileName);
  }
}

syncCommonModule('matchCanonical.js', [
  'createMatch',
  'getMatch',
  'joinMatch',
  'updateScore',
  'deleteMyMatch',
  'leaveMatch',
]);

syncCommonModule('rosterAvatarEnrich.js', ['getMatch', 'listMyMatches', 'joinMatch']);
