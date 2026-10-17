#!/usr/bin/env node
/**
 * Cursor stop hook：Agent 结束后若有未提交改动，自动 commit + push。
 * 作为规则兜底；commit message 为通用摘要，Agent 仍应优先写语义化 message。
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function runSafe(cmd) {
  try {
    return run(cmd);
  } catch {
    return '';
  }
}

/** @param {string} rel */
function isBlocked(rel) {
  const n = rel.replace(/\\/g, '/');
  if (n === '.env' || n.startsWith('.env.')) return true;
  if (n.includes('project.private.config.json')) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(n)) return true;
  return false;
}

function main() {
  try {
    readFileSync(0, 'utf8');
  } catch {
    /* stdin optional for stop hook */
  }

  const porcelain = runSafe('git status --porcelain');
  if (!porcelain) process.exit(0);

  const files = porcelain
    .split('\n')
    .map((line) => line.slice(3).trim().replace(/^"+|"+$/g, ''))
    .filter(Boolean);

  const allowed = files.filter((f) => !isBlocked(f));
  if (allowed.length === 0) {
    console.error('[auto-sync-github] 仅有敏感文件变更，跳过自动提交');
    process.exit(0);
  }

  const branch = runSafe('git rev-parse --abbrev-ref HEAD') || 'HEAD';
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const msg = `chore: auto-sync ${branch} @ ${ts}`;

  for (const f of allowed) {
    spawnSync('git', ['add', '--', f], { cwd: ROOT, stdio: 'ignore' });
  }

  const commit = spawnSync('git', ['commit', '-m', msg], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (commit.status !== 0) {
    const err = (commit.stderr || commit.stdout || '').trim();
    if (/nothing to commit/i.test(err)) process.exit(0);
    console.error('[auto-sync-github] commit failed:', err);
    process.exit(0);
  }

  const upstream = runSafe('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
  const pushArgs = upstream
    ? ['push']
    : ['push', '-u', 'origin', branch === 'HEAD' ? 'HEAD' : branch];

  const push = spawnSync('git', pushArgs, { cwd: ROOT, encoding: 'utf8' });
  if (push.status !== 0) {
    console.error('[auto-sync-github] push failed:', (push.stderr || push.stdout || '').trim());
  } else {
    console.error('[auto-sync-github] pushed', branch);
  }
  process.exit(0);
}

main();
