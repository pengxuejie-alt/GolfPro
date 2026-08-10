/**
 * 微信小程序 · 计分海报（仅「生成海报」路径）：Canvas 2D + canvas.createImage。
 * @see https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html#Canvas-2D-%E7%A4%BA%E4%BE%8B%E4%BB%A3%E7%A0%81
 */

import type { ComponentPublicInstance } from 'vue';

export const POSTER_LOGICAL_WIDTH = 750;
export const POSTER_LOGICAL_HEIGHT = 1334;

export interface PersonalScorePoster2dImages {
  header: MiniCanvasImg | null;
  qr: MiniCanvasImg;
  avatar: MiniCanvasImg | null;
}

/** Canvas 2D node.createImage；避免依赖 miniprogram 类型包 */
export type MiniCanvasImg = Record<string, unknown> & {
  onload?: (() => void) | null;
  onerror?: ((ev: unknown) => void) | null;
  src: string;
};

export type AnyMiniCanvasNode = {
  width: number;
  height: number;
  getContext: (t: '2d') => CanvasRenderingContext2D | null;
  createImage: () => MiniCanvasImg;
};

/** 海报前九 / 后九小结（含未打完场次） */
export interface PosterNineSummary {
  strokes: number;
  played: number;
  /** 已打洞合计杆差；played===0 时为 null */
  diff: number | null;
}

export interface PersonalScorePoster2dModel {
  courseName: string;
  dateStr: string;
  nickname: string;
  total: number;
  /** 相对「已录入洞」标准杆之和的差值 */
  diff: number;
  frontNine: PosterNineSummary;
  backNine: PosterNineSummary;
  stat: { birdie: number; eagleOrBetter: number; par: number; bogeyPlus: number };
  /** 当前分享球手的 0～17 洞成绩 */
  getScore: (holeIndex: number) => number;
  getPar: (holeIndex: number) => number;
}

function posterFont(size: number) {
  return `${size}px "PingFang SC", system-ui, -apple-system, sans-serif`;
}

function posterRoundPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(Math.max(0, r), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function posterFillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  posterRoundPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function posterStrokeRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  posterRoundPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

function posterStrokeFillText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  stroke: string,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = posterFont(fontSize);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      if (!dx && !dy) continue;
      if (Math.abs(dx) + Math.abs(dy) > 5) continue;
      ctx.fillStyle = stroke;
      ctx.fillText(text, x + dx, y + dy);
    }
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawPosterHoleScoreFrame(
  ctx: CanvasRenderingContext2D,
  tcx: number,
  tcy: number,
  delta: number,
  hasScore: boolean,
) {
  if (!hasScore) return;
  const red = '#dc2626';
  const strokeSq = '#ea580c';
  if (delta < 0) {
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(tcx, tcy, 22, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (delta === 0) return;
  ctx.strokeStyle = strokeSq;
  ctx.lineWidth = 2;
  if (delta === 1) {
    const s = 34;
    ctx.strokeRect(tcx - s / 2, tcy - s / 2, s, s);
    return;
  }
  /* +2 及以上双方框：外框放大，避免与两位数重叠 */
  const o = 50;
  const inn = 34;
  ctx.strokeRect(tcx - o / 2, tcy - o / 2, o, o);
  ctx.strokeRect(tcx - inn / 2, tcy - inn / 2, inn, inn);
}

export async function acquireMpPosterCanvas2d(
  componentInstance?: ComponentPublicInstance | null | undefined,
  selector = '#scorePosterCanvas2d',
): Promise<{ canvas: AnyMiniCanvasNode; ctx: CanvasRenderingContext2D; dpr: number }> {
  const logicalW = POSTER_LOGICAL_WIDTH;
  const logicalH = POSTER_LOGICAL_HEIGHT;

  const runQuery = (
    scope: ComponentPublicInstance | null | undefined,
  ): Promise<{ canvas: AnyMiniCanvasNode; ctx: CanvasRenderingContext2D; dpr: number }> =>
    new Promise((resolve, reject) => {
      const q = scope ? uni.createSelectorQuery().in(scope as never) : uni.createSelectorQuery();
      q.select(selector).fields(
        { node: true, size: true },
        (result: unknown) => {
          const raw = Array.isArray(result) ? result[0] : result;
          const meta = raw as { node?: AnyMiniCanvasNode } | undefined;
          const canvasNode = meta?.node;
          if (!canvasNode) {
            reject(new Error('[poster2d] canvas node not found'));
            return;
          }
          const ctx2 = canvasNode.getContext('2d') as CanvasRenderingContext2D | null;
          if (!ctx2) {
            reject(new Error('[poster2d] getContext("2d") failed'));
            return;
          }
          const dpr = Number(uni.getSystemInfoSync().pixelRatio) || 1;
          canvasNode.width = Math.round(logicalW * dpr);
          canvasNode.height = Math.round(logicalH * dpr);
          ctx2.scale(dpr, dpr);
          resolve({ canvas: canvasNode, ctx: ctx2, dpr });
        },
      )
        .exec();
    });

  try {
    return await runQuery(componentInstance ?? undefined);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? '');
    if (componentInstance && msg.includes('canvas node not found')) {
      try {
        return await runQuery(undefined);
      } catch {
        throw e;
      }
    }
    throw e;
  }
}

function tryLoadMpCanvasImageOnce(canvasNode: AnyMiniCanvasNode, src: string): Promise<MiniCanvasImg> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('[poster2d] empty image src'));
      return;
    }
    const img = canvasNode.createImage();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err ?? new Error('[poster2d] image load error'));
    img.src = src;
  });
}

function posterMpGetImageInfoPath(src: string): Promise<string> {
  return new Promise((resolve) => {
    uni.getImageInfo({
      src,
      success: (r) => resolve((r as { path?: string }).path || ''),
      fail: () => resolve(''),
    });
  });
}

function posterMpDownloadToTemp(httpUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(httpUrl)) {
      resolve('');
      return;
    }
    uni.downloadFile({
      url: httpUrl,
      success: (r) => resolve((r as { tempFilePath?: string }).tempFilePath || ''),
      fail: () => resolve(''),
    });
  });
}

/** 兼容模拟器/createImage：`/static/a.png`、`static/a.png` 等对包内资源解析不一致 */
function posterLocalPathVariants(src: string): readonly string[] {
  const s = String(src || '').trim();
  if (!s || /^wxfile:\/\//i.test(s)) return [s];
  if (/^https?:\/\//i.test(s)) return [s];
  const trimmed = s.replace(/^\/+/, '');
  const slash = trimmed ? `/${trimmed}` : '';
  const uniq = [...new Set([s, trimmed, ...(slash ? [slash] : [])])].filter(Boolean);
  return uniq;
}

/** 模拟器及部分基础库对「代码包直链」解码失败 → 拷贝到用户目录再 draw */
function posterTryCopyPkgImageToWritable(localSrc: string): Promise<string> {
  return new Promise((resolve) => {
    if (!localSrc || /^https?:\/\//i.test(localSrc) || /^wxfile:\/\//i.test(localSrc)) {
      resolve('');
      return;
    }
    const gl = globalThis as Record<string, unknown>;
    const wxMini = gl.wx as
      | {
          getFileSystemManager?: () => {
            copyFile: (opt: Record<string, unknown>) => void;
          };
          env?: { USER_DATA_PATH?: string };
        }
      | undefined;
    const fm = wxMini?.getFileSystemManager?.();
    const userRoot = wxMini?.env?.USER_DATA_PATH;
    if (!fm || !userRoot) {
      resolve('');
      return;
    }
    const base = localSrc.replace(/^\/+/, '');
    const safeName = base.split('/').pop() || `img_${Date.now()}.png`;
    const destPath = `${userRoot}/poster2d_${Date.now()}_${Math.floor(Math.random() * 1e9)}_${safeName}`;
    const tryPaths = [...new Set([base, `/${base}`, localSrc].filter(Boolean))];
    let i = 0;
    const next = (): void => {
      if (i >= tryPaths.length) {
        resolve('');
        return;
      }
      const srcPath = tryPaths[i++] ?? '';
      fm.copyFile({
        srcPath,
        destPath,
        success: () => resolve(destPath),
        fail: () => next(),
      });
    };
    next();
  });
}

/**
 * Canvas 2D 的 createImage 在真机上常对「getImageInfo 返回的 path」解码失败，需再试包内原始路径；
 * 网络头像/图需先 downloadFile 到临时路径。
 */
export async function loadMpCanvas2dImage(
  canvasNode: AnyMiniCanvasNode,
  primary: string,
  fallbacks: readonly string[] = [],
): Promise<MiniCanvasImg> {
  const ordered = [primary, ...fallbacks].filter(Boolean);
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const raw of ordered) {
    const variants = posterLocalPathVariants(raw);
    for (const src of variants) {
      if (seen.has(src)) continue;
      seen.add(src);
      expanded.push(src);
      if (/^https?:\/\//i.test(src)) {
        const tmp = await posterMpDownloadToTemp(src);
        if (tmp && !seen.has(tmp)) {
          seen.add(tmp);
          expanded.push(tmp);
        }
      }
      const infoPath = await posterMpGetImageInfoPath(src);
      if (infoPath && !seen.has(infoPath)) {
        seen.add(infoPath);
        expanded.push(infoPath);
      }
    }
  }

  /** 延后追加：拷贝包内路径到可写目录（与上面 push 互不干扰） */
  const copyAdds: string[] = [];
  for (const cand of [...expanded]) {
    if (/^https?:\/\//i.test(cand) || /^wxfile:\/\//i.test(cand)) continue;
    const cp = await posterTryCopyPkgImageToWritable(cand);
    if (cp && !seen.has(cp)) {
      seen.add(cp);
      copyAdds.push(cp);
    }
  }
  expanded.push(...copyAdds);

  let lastErr: unknown;
  for (const cand of expanded) {
    try {
      return await tryLoadMpCanvasImageOnce(canvasNode, cand);
    } catch (e) {
      lastErr = e;
    }
  }
  const errMsg = '[poster2d] image load error';
  throw lastErr instanceof Error ? lastErr : new Error(errMsg);
}

/**
 * Canvas 导出前留白一帧即可；逻辑层无稳定 RAF（且部分构建会抽到 vendor 报错），仅用定时器。
 */
function posterDelayTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      setTimeout(() => resolve(), 16);
    }, 16);
  });
}

export async function exportMpPosterCanvas2dTempPath(
  canvasNode: AnyMiniCanvasNode,
  dpr: number,
  componentInstance?: ComponentPublicInstance | null | undefined,
): Promise<string> {
  await posterDelayTwoFrames();
  const logicalW = POSTER_LOGICAL_WIDTH;
  const logicalH = POSTER_LOGICAL_HEIGHT;
  return new Promise((resolve, reject) => {
    (uni as { canvasToTempFilePath: (opt: Record<string, unknown>, inst?: unknown) => void }).canvasToTempFilePath(
      {
        canvas: canvasNode,
        destWidth: Math.round(logicalW * dpr),
        destHeight: Math.round(logicalH * dpr),
        fileType: 'png',
        quality: 1,
        success: (r: { tempFilePath: string }) => resolve(r.tempFilePath),
        fail: (e: unknown) => reject(e),
      },
      componentInstance,
    );
  });
}

/** 在给定已为逻辑坐标系的 ctx 上绘制整张海报（已 scale dpr） */
export function paintPersonalScorePoster2d(
  ctx: CanvasRenderingContext2D,
  images: PersonalScorePoster2dImages,
  model: PersonalScorePoster2dModel,
) {
  const w = POSTER_LOGICAL_WIDTH;
  const h = POSTER_LOGICAL_HEIGHT;
  const posterGreen = '#6b9b6e';
  const posterGreenLine = '#cde2cf';
  const posterMintRow = '#ecf8ec';
  const posterMintStroke = '#c8e6ca';

  const cardX = 20;
  const cardW = 710;
  const cardR = 24;
  const innerPad = 18;
  const labelColW = 56;
  const rowLeft = cardX + innerPad;
  const rowW = cardW - innerPad * 2;
  const innerLeft = rowLeft + labelColW;
  const cardInnerW = rowW - labelColW;
  const colW = cardInnerW / 9;
  const labelRight = rowLeft + labelColW - 8;

  const summaryLineH = 58;
  const blockGap = 18;
  const statBlockH = 84;
  const secTitleH = 30;
  const R_H = 40;
  const R_PAR = 34;
  const R_SCORE = 32;
  const R_DIFF = 64;
  const oneNineH = secTitleH + R_H + R_PAR + R_SCORE + R_DIFF;
  const cardH =
    innerPad +
    summaryLineH +
    blockGap +
    oneNineH +
    blockGap +
    oneNineH +
    14 +
    statBlockH +
    innerPad;
  const HEAD_H = 392;
  const cardY = HEAD_H + 14;
  const footY = cardY + cardH + 12;

  const { total, diff, frontNine, backNine, stat, nickname, courseName, dateStr, getScore, getPar } = model;

  const posterNineLine = (s: PosterNineSummary): string => {
    if (s.played === 0) return '—';
    const d = s.diff;
    if (d === null) return `${s.strokes}杆`;
    const tail = d === 0 ? ' · E' : d > 0 ? ` · +${d}` : ` · ${d}`;
    return `${s.strokes}杆${tail}`;
  };

  const posterDiffText = (d: number): string =>
    d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;

  /** 清空（避免热重绘叠影） */
  ctx.clearRect(0, 0, w, h);

  if (images.header) {
    ctx.drawImage(images.header as unknown as CanvasImageSource, 0, 0, w, HEAD_H);
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, HEAD_H + 140);
    bg.addColorStop(0, '#1a4d38');
    bg.addColorStop(1, '#c5ddcc');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, HEAD_H + 140);
  }

  const featherY = HEAD_H - 52;
  const bodyG = ctx.createLinearGradient(0, featherY, 0, Math.min(h, HEAD_H + 280));
  bodyG.addColorStop(0, 'rgba(255,255,255,0)');
  bodyG.addColorStop(0.15, '#f0f6f2');
  bodyG.addColorStop(0.4, '#f8fafc');
  bodyG.addColorStop(1, '#ffffff');
  ctx.fillStyle = bodyG;
  ctx.fillRect(0, featherY, w, h - featherY);

  const hGradTop = ctx.createLinearGradient(0, 0, 0, HEAD_H);
  hGradTop.addColorStop(0, 'rgba(0, 16, 10, 0.58)');
  hGradTop.addColorStop(0.45, 'rgba(0, 26, 16, 0.36)');
  hGradTop.addColorStop(1, 'rgba(0, 38, 24, 0.2)');
  ctx.fillStyle = hGradTop;
  ctx.fillRect(0, 0, w, HEAD_H);

  ctx.fillStyle = 'rgba(5, 28, 18, 0.55)';
  posterFillRoundRect(ctx, 14, 44, 528, 278, 20);

  const posterMainTitle = 'Golfdate计分';
  posterStrokeFillText(ctx, posterMainTitle, 36, 96, 52, '#ffffff', 'rgba(0,24,14,0.78)', 'left');

  ctx.font = posterFont(52);
  const titleUnderlineW = Math.max(340, ctx.measureText(posterMainTitle).width || 400);
  ctx.strokeStyle = '#c8f565';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(36, 114);
  ctx.lineTo(36 + titleUnderlineW, 114);
  ctx.stroke();

  posterStrokeFillText(
    ctx,
    '挥杆 · 记录 · 超越',
    36,
    146,
    20,
    'rgba(255,255,255,0.96)',
    'rgba(0,24,14,0.72)',
    'left',
  );
  posterStrokeFillText(ctx, courseName, 36, 178, 24, '#ffffff', 'rgba(0,24,14,0.78)', 'left');
  posterStrokeFillText(ctx, dateStr, 36, 210, 20, 'rgba(255,255,255,0.94)', 'rgba(0,24,14,0.72)', 'left');

  if (images.avatar) {
    const avR = 41;
    const avCx = 88;
    const avCy = 271;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(images.avatar as unknown as CanvasImageSource, avCx - avR, avCy - avR, avR * 2, avR * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.stroke();
  }
  posterStrokeFillText(ctx, nickname || '我自己', 154, 279, 31, '#ffffff', 'rgba(0,24,14,0.78)', 'left');
  posterStrokeFillText(ctx, '总杆', 706, 228, 23, 'rgba(255,255,255,0.92)', 'rgba(0,24,14,0.72)', 'right');
  posterStrokeFillText(ctx, `${total || 0}`, 706, 304, 74, '#ffffff', 'rgba(0,24,14,0.78)', 'right');

  ctx.fillStyle = '#ffffff';
  posterFillRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.strokeStyle = '#dfe8e6';
  ctx.lineWidth = 1.5;
  posterStrokeRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);

  let yIn = cardY + innerPad;

  ctx.font = posterFont(20);
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`前九 OUT  ${posterNineLine(frontNine)}`, rowLeft, yIn + 24);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#475569';
  ctx.font = posterFont(20);
  ctx.fillText(`后九 IN  ${posterNineLine(backNine)}`, rowLeft + rowW, yIn + 24);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = posterFont(17);
  const playedAll = frontNine.played + backNine.played;
  ctx.fillText(
    `总杆 ${total || 0}  ·  较标准杆 ${posterDiffText(diff)}  ·  已打 ${playedAll}/18 洞`,
    cardX + cardW / 2,
    yIn + 50,
  );
  yIn += summaryLineH + blockGap;

  const drawNineBlock = (startHole: number, sectionTitle: string) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#334155';
    ctx.font = posterFont(22);
    ctx.fillText(sectionTitle, rowLeft, yIn + 20);
    yIn += secTitleH;

    ctx.fillStyle = posterGreen;
    ctx.fillRect(rowLeft, yIn, rowW, R_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = posterFont(17);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('洞数', labelRight, yIn + R_H / 2);
    for (let col = 0; col < 9; col++) {
      const hi = startHole + col;
      const tcx = innerLeft + col * colW + colW / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = posterFont(19);
      ctx.fillText(`${hi + 1}`, tcx, yIn + R_H / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    yIn += R_H;

    ctx.fillStyle = posterMintRow;
    ctx.fillRect(rowLeft, yIn, rowW, R_PAR);
    ctx.strokeStyle = posterMintStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(rowLeft, yIn, rowW, R_PAR);
    ctx.fillStyle = '#166534';
    ctx.font = posterFont(16);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('标准杆', labelRight, yIn + R_PAR / 2);
    for (let col = 0; col < 9; col++) {
      const hi = startHole + col;
      const par = getPar(hi);
      const tcx = innerLeft + col * colW + colW / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = posterFont(20);
      ctx.fillText(`${par}`, tcx, yIn + R_PAR / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    yIn += R_PAR;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(rowLeft, yIn, rowW, R_SCORE);
    ctx.strokeStyle = posterGreenLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(rowLeft, yIn, rowW, R_SCORE);
    ctx.fillStyle = '#334155';
    ctx.font = posterFont(16);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('杆数', labelRight, yIn + R_SCORE / 2);
    for (let col = 0; col < 9; col++) {
      const hi = startHole + col;
      const sc = getScore(hi);
      const tcx = innerLeft + col * colW + colW / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = posterFont(19);
      ctx.fillStyle = sc > 0 ? '#0f172a' : '#94a3b8';
      ctx.fillText(sc > 0 ? `${sc}` : '—', tcx, yIn + R_SCORE / 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    yIn += R_SCORE;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rowLeft, yIn, rowW, R_DIFF);
    ctx.strokeStyle = posterGreenLine;
    ctx.strokeRect(rowLeft, yIn, rowW, R_DIFF);
    ctx.fillStyle = '#64748b';
    ctx.font = posterFont(16);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('杆差', labelRight, yIn + R_DIFF / 2);
    for (let col = 0; col < 9; col++) {
      const hi = startHole + col;
      const sc = getScore(hi);
      const par = getPar(hi);
      const delta = sc > 0 ? sc - par : 0;
      const tcx = innerLeft + col * colW + colW / 2;
      const tcy = yIn + R_DIFF / 2;
      drawPosterHoleScoreFrame(ctx, tcx, tcy, delta, sc > 0);
      const diffLabel = sc > 0 ? (delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`) : '—';
      if (!sc) {
        ctx.fillStyle = '#94a3b8';
      } else if (delta < 0) {
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#0f172a';
      }
      ctx.font = posterFont(sc > 0 && delta > 1 ? 18 : 21);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(diffLabel, tcx, tcy);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    yIn += R_DIFF;
  };

  drawNineBlock(0, '前九 · OUT');
  yIn += blockGap;
  drawNineBlock(9, '后九 · IN');

  const statPadX = Math.max(cardX + innerPad, 24);
  ctx.fillStyle = '#334155';
  ctx.font = posterFont(23);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const statLine1 = `老鹰+ ${stat.eagleOrBetter} 洞  ·  小鸟 ${stat.birdie} 洞`;
  const statLine2 = `保帕 ${stat.par} 洞  ·  柏忌+ ${stat.bogeyPlus} 洞`;
  ctx.fillText(statLine1, statPadX, yIn + 30);
  ctx.fillText(statLine2, statPadX, yIn + 62);

  /** 小程序码区：不再有底部绿色总杆条幅（曾与码重叠）；总杆已在头部与纪要行展示 */
  const qrSize = 138;
  const qrBottomMargin = 16;
  const qrGapUnderCard = 18;
  const qrBandTop = Math.min(footY + qrGapUnderCard, h - qrSize - qrBottomMargin);
  const qrX = cardX + 18;
  const qrCx = qrX + qrSize / 2;
  const qrCy = qrBandTop + qrSize / 2;

  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(qrCx, qrCy, qrSize / 2 + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(qrCx, qrCy, qrSize / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(images.qr as unknown as CanvasImageSource, qrX, qrBandTop, qrSize, qrSize);
  ctx.restore();

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(qrCx, qrCy, qrSize / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = posterFont(22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('长按识别小程序码', qrX + qrSize + 16, qrBandTop + 46);
  ctx.fillStyle = '#64748b';
  ctx.font = posterFont(19);
  ctx.fillText('记录每一次挥杆时刻', qrX + qrSize + 16, qrBandTop + 82);
}
