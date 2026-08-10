/**
 * 微信云存储头像在列表里的展示安全处理。
 *
 * 背景（控制台刷屏来源）：
 * 1）getTempFileURL 得到的 https://*.tcb.qcloud.la/...?sign=...&t=... 为数小时有效的临时链。
 *    若被写进数据库 / 比赛 roster，过一段时间再渲染 <image> 会 403（签名过期）。
 * 2）cloud:// fileID 可长期保存；应由 getTempFileURL 在展示前换链，或用 <image cloud://（真机尚可，模拟器偶有异常）。
 */

import { isWxCloudFileId } from './mpCloudFileUrl';

/** cloud 常写 players[].avatarUrl，列表只渲染 user_list 时会丢头像 — 就地补上 */
export function mergeRosterAvatarFieldsIntoUserList(row: Record<string, unknown>): void {
  if (!row || typeof row !== 'object') return;
  const ul = row.user_list;
  const pl = row.players;
  if (!Array.isArray(ul) || ul.length === 0 || !Array.isArray(pl) || pl.length === 0) return;

  function pid(p: unknown): string {
    if (!p || typeof p !== 'object') return '';
    const o = p as Record<string, unknown>;
    return String(o.uid ?? o.openId ?? o.openid ?? o.player_uid ?? o.id ?? '').trim();
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const p of pl) {
    if (!p || typeof p !== 'object') continue;
    const id = pid(p);
    if (id && !id.startsWith('temp_') && !id.startsWith('virtual')) {
      byId.set(id, p as Record<string, unknown>);
    }
  }

  for (let i = 0; i < ul.length; i++) {
    const u = ul[i];
    const uo = u && typeof u === 'object' ? (u as Record<string, unknown>) : null;
    if (!uo) continue;

    const uAv =
      uo.avatar != null && String(uo.avatar).trim() !== '' ? String(uo.avatar).trim() : '';
    const uUrl =
      uo.avatarUrl != null && String(uo.avatarUrl).trim() !== '' ? String(uo.avatarUrl).trim() : '';
    if (uAv || uUrl) continue;

    const idU = pid(uo);
    let po: Record<string, unknown> | undefined = idU ? byId.get(idU) : undefined;
    if (!po && i < pl.length && pl[i] && typeof pl[i] === 'object') {
      po = pl[i] as Record<string, unknown>;
    }
    if (!po) continue;

    const pAv =
      po.avatar != null && String(po.avatar).trim() !== '' ? String(po.avatar).trim() : '';
    const pUrl =
      po.avatarUrl != null && String(po.avatarUrl).trim() !== '' ? String(po.avatarUrl).trim() : '';
    if (pAv) uo.avatar = pAv;
    if (pUrl || pAv) uo.avatarUrl = (pUrl || pAv || '') as string;
  }
}

/** 典型「临时下载域名 + 签名」形态，失效后必 403，不宜长期当 src */
export function looksLikeExpiredProneTencentTempHttps(src: string): boolean {
  const s = String(src || '').trim();
  if (!s || !/^https:\/\//i.test(s)) return false;
  if (!/[?&]sign=/i.test(s)) return false;
  return /\.tcb\.qcloud\.la\b/i.test(s) || /\.myqcloud\.com\b/i.test(s);
}

/** <image :src> 用：剔除 cloud://（开发者工具会拼成 /pages/.../cloud:// 导致 500）与易过期临时链 */
export function safeMpAvatarImgSrc(raw: unknown, fallback: string): string {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return fallback;
  if (s.startsWith('cloud://')) return fallback;
  if (looksLikeExpiredProneTencentTempHttps(s)) return fallback;
  return s;
}

/** 写入列表/缓存前：去掉不可直接展示的 cloud://（保留 fileID 请用 avatarCloudId 等字段，此处仅清展示字段） */
export function stripCloudAvatarFieldsInRoster(roster: unknown): void {
  if (!Array.isArray(roster)) return;
  for (const raw of roster) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    for (const key of ['avatar', 'avatarUrl']) {
      const v = o[key] != null ? String(o[key]).trim() : '';
      if (v.startsWith('cloud://')) o[key] = '';
    }
  }
}

export function stripCloudAvatarsInMatchList(matches: unknown): void {
  const list = Array.isArray(matches) ? matches : [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    stripCloudAvatarFieldsInRoster(row.user_list);
    stripCloudAvatarFieldsInRoster(row.players);
  }
}

/**
 * 列表数据就位后：合并 user_list/players 头像字段；去掉易过期 COS 签名链。
 *
 * cloud:// 由 `resolveCloudAvatarsInMatchList` 在展示前换临时 https；勿把临时链写回云库/持久缓存。
 */
export async function hydratePlayerAvatarsInMatchList(matches: unknown): Promise<void> {
  const list = Array.isArray(matches) ? matches : [];

  function scanRoster(roster: unknown) {
    if (!Array.isArray(roster)) return;
    for (const p of roster) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const a = String(o.avatar ?? o.avatarUrl ?? '').trim();
      if (looksLikeExpiredProneTencentTempHttps(a)) {
        o.avatar = '';
        o.avatarUrl = '';
      }
    }
  }

  for (const m of list) {
    const row = m as Record<string, unknown>;
    mergeRosterAvatarFieldsIntoUserList(row);
    scanRoster(row.user_list);
    scanRoster(row.players);
  }
}
