/**
 * 云库 createMatch / saveMatch 可能写 scores，客户端多用 hole_scores；
 * 若 hole_scores 为 [] 而 scores 有杆数，用 ?? 会误选空数组导致计分页全空。
 */
export function strokeCountInHoleList(arr: unknown): number {
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (const h of arr) {
    if (!h || typeof h !== 'object') continue;
    const scores = (h as { scores?: unknown[] }).scores;
    if (!Array.isArray(scores)) continue;
    for (const s of scores) {
      if (Number(s) > 0) n++;
    }
  }
  return n;
}

/** 就地补全 row.hole_scores，保证与 scores 中「更有数据」的一侧一致 */
export function normalizeMatchHoleScoresForClient(row: Record<string, unknown> | null | undefined): void {
  if (!row || typeof row !== 'object') return;
  const hs = row.hole_scores;
  const sc = row.scores;
  const nHs = strokeCountInHoleList(hs);
  const nSc = strokeCountInHoleList(sc);
  if (nSc > nHs) {
    row.hole_scores = sc;
    return;
  }
  const hsLen = Array.isArray(hs) ? hs.length : 0;
  if (hsLen === 0 && Array.isArray(sc) && sc.length > 0) {
    row.hole_scores = sc;
  }
}
