/**
 * 微信上传云函数时只打包各函数目录，不会带上 ../common/。
 * 将 matchCanonical 同步到每个依赖它的云函数目录内，避免体验版/真机 callFunction 失败。
 */
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'cloudfunctions', 'common', 'matchCanonical.js');
if (!existsSync(src)) {
  console.error('[sync-cloud-matchCanonical] missing', src);
  process.exit(1);
}

const targets = [
  'createMatch',
  'getMatch',
  'joinMatch',
  'updateScore',
  'deleteMyMatch',
  'leaveMatch',
];

for (const name of targets) {
  const dir = path.join(root, 'cloudfunctions', name);
  if (!existsSync(dir)) {
    console.warn('[sync-cloud-matchCanonical] skip missing dir', name);
    continue;
  }
  const dest = path.join(dir, 'matchCanonical.js');
  cpSync(src, dest);
  console.info('[sync-cloud-matchCanonical]', name, '← common/matchCanonical.js');
}
