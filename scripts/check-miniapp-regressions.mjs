/**
 * golfpro 微信小程序：头像 / 计分页 / 云函数打包 回归检查。
 *
 * 用法：
 *   npm run check:miniapp-regression
 *   npm run check:miniapp-regression -- --fix   # 仅安全自动修复（同步 common 模块）
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');

const errors = [];
const warnings = [];
const fixed = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function ok(msg) {
  console.info('[check:miniapp-regression] OK', msg);
}

function readText(rel) {
  const p = path.join(root, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf-8');
}

function fileExists(rel) {
  return existsSync(path.join(root, rel));
}

// --- 云函数 common 模块必须复制进各函数目录（微信上传不含 ../common）---
const CF_NEED_ROSTER = ['getMatch', 'listMyMatches', 'joinMatch'];
const CF_NEED_CANONICAL = [
  'createMatch',
  'getMatch',
  'joinMatch',
  'updateScore',
  'deleteMyMatch',
  'leaveMatch',
];

if (!fileExists('cloudfunctions/common/rosterAvatarEnrich.js')) {
  fail('缺少 cloudfunctions/common/rosterAvatarEnrich.js');
}
if (!fileExists('cloudfunctions/common/matchCanonical.js')) {
  fail('缺少 cloudfunctions/common/matchCanonical.js');
}

for (const name of CF_NEED_ROSTER) {
  const rel = `cloudfunctions/${name}/rosterAvatarEnrich.js`;
  if (!fileExists(rel)) {
    fail(`缺少 ${rel}（请运行 node scripts/sync-cloud-matchCanonical.mjs）`);
  } else {
    ok(rel);
  }
  const idx = readText(`cloudfunctions/${name}/index.js`);
  if (idx && idx.includes("../common/rosterAvatarEnrich")) {
    fail(`${name}/index.js 仍 require('../common/rosterAvatarEnrich')，应改为 ./rosterAvatarEnrich`);
  }
  if (idx && !idx.includes('./rosterAvatarEnrich')) {
    warn(`${name}/index.js 未找到 require('./rosterAvatarEnrich')`);
  }
}

for (const name of CF_NEED_CANONICAL) {
  const rel = `cloudfunctions/${name}/matchCanonical.js`;
  if (!fileExists(rel)) {
    fail(`缺少 ${rel}`);
  }
}

const syncScript = readText('scripts/sync-cloud-matchCanonical.mjs') || '';
if (!syncScript.includes('rosterAvatarEnrich.js')) {
  fail('scripts/sync-cloud-matchCanonical.mjs 未同步 rosterAvatarEnrich.js');
}
for (const scriptKey of ['dev:mp-weixin', 'build:mp-weixin']) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
  const cmd = pkg.scripts?.[scriptKey] || '';
  if (!cmd.includes('sync-cloud-matchCanonical.mjs')) {
    fail(`package.json ${scriptKey} 未在构建前运行 sync-cloud-matchCanonical.mjs`);
  }
}

// --- 客户端头像 / 计分反模式 ---
const fetchProf = readText('src/utils/fetchUserProfilesForOpenIds.ts');
if (fetchProf) {
  if (!fetchProf.includes('isAvatarUrlDisplayable')) {
    fail('fetchUserProfilesForOpenIds 应使用 isAvatarUrlDisplayable 判断仍缺头像（避免 tcb 临时 https 误报）');
  }
  if (fetchProf.includes('looksLikeExpiredProneTencentTempHttps(av)) prof.avatarUrl')) {
    fail('fetchUserProfilesForOpenIds 不得在 resolveProfileMapAvatarsForDisplay 中 strip 会话内 tcb https');
  }
}

const mpAvatar = readText('src/utils/mpAvatarSrc.ts');
if (mpAvatar && !mpAvatar.includes('export function isAvatarUrlDisplayable')) {
  fail('mpAvatarSrc.ts 缺少 isAvatarUrlDisplayable');
}

const scorecard = readText('src/pages/scorecard/scorecard.vue');
if (scorecard) {
  if (!scorecard.includes('sessionPrefillAvatars')) {
    fail('scorecard.vue 缺少 sessionPrefillAvatars（首页预填防闪）');
  }
  if (!scorecard.includes('rosterIdsSignature(matchStore.user_list)')) {
    fail('scorecard localRosterIdsSig 应使用 rosterIdsSignature，与 cloud 一致');
  }
  if (!scorecard.includes('stashScorecardPrefillFromIndex') && !scorecard.includes('scorecardPrefill')) {
    warn('scorecard 未引用 scorecardPrefill 工具（确认首页 prefill 链路）');
  }
}

const indexVue = readText('src/pages/index/index.vue');
if (indexVue && !indexVue.includes('stashScorecardPrefillFromIndex')) {
  fail('index.vue 进计分页前应 stashScorecardPrefillFromIndex');
}

const rosterNorm = readText('src/utils/rosterPlayerNormalize.ts');
if (!rosterNorm) {
  fail('缺少 src/utils/rosterPlayerNormalize.ts');
}

const prefill = readText('src/utils/scorecardPrefill.ts');
if (!prefill) {
  fail('缺少 src/utils/scorecardPrefill.ts');
}

// --- 安全 auto-fix ---
if (fix && errors.some((e) => e.includes('rosterAvatarEnrich') || e.includes('sync-cloud'))) {
  const r = spawnSync(process.execPath, ['scripts/sync-cloud-matchCanonical.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status === 0) {
    fixed.push('已运行 scripts/sync-cloud-matchCanonical.mjs');
  } else {
    fail('auto-fix: sync-cloud-matchCanonical.mjs 执行失败');
  }
}

console.info('\n--- golfpro miniapp regression check ---');
if (fixed.length) {
  console.info('Auto-fixed:', fixed.join('; '));
}
if (warnings.length) {
  console.warn('Warnings:');
  for (const w of warnings) console.warn('  -', w);
}
if (errors.length) {
  console.error('Failures:');
  for (const e of errors) console.error('  -', e);
  console.error(`\n${errors.length} check(s) failed. Run with --fix for safe cloud sync only.`);
  process.exit(1);
}

console.info('\nAll regression checks passed.');
if (warnings.length) {
  console.info(`${warnings.length} warning(s) — review above.`);
}
