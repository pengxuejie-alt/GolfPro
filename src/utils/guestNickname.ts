import { isLikelyWeChatOpenId } from './rosterAvatarDisplay';

/** 未提供昵称的受邀用户 / 围观者默认展示名 */
export const GUEST_NICKNAME = '游客';

export function defaultGuestNickname(): string {
  return GUEST_NICKNAME;
}

/** 可随后台 users / 用户补资料覆盖的占位昵称 */
export function isGuestOrPlaceholderNickname(nick: string | undefined, playerId?: string): boolean {
  const n = String(nick || '').trim();
  if (!n || n === GUEST_NICKNAME) return true;
  /** 历史默认名，仍视为占位 */
  if (n === '球友') return true;
  if (/^球友[a-zA-Z0-9_-]{1,8}$/.test(n)) return true;
  if (isLikelyWeChatOpenId(n)) return true;
  if (playerId && n === playerId) return true;
  return false;
}
