/**
 * 微信小程序 · 计分海报（仅「生成海报」路径）：Canvas 2D + canvas.createImage。
 * @see https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html#Canvas-2D-%E7%A4%BA%E4%BE%8B%E4%BB%A3%E7%A0%81
 */

import type { ComponentPublicInstance } from 'vue';
import { paintCleanScorePoster } from './scorePosterLayout';

export const POSTER_LOGICAL_WIDTH = 750;
export const POSTER_LOGICAL_HEIGHT = 1334;
/** 横屏海报：18 洞同一行 */
export const POSTER_LANDSCAPE_WIDTH = 1334;
export const POSTER_LANDSCAPE_HEIGHT = 750;

export type PosterOrientation = 'portrait' | 'landscape';

export function posterLogicalSize(orientation: PosterOrientation = 'portrait') {
  if (orientation === 'landscape') {
    return { width: POSTER_LANDSCAPE_WIDTH, height: POSTER_LANDSCAPE_HEIGHT };
  }
  return { width: POSTER_LOGICAL_WIDTH, height: POSTER_LOGICAL_HEIGHT };
}

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
  scale = 1,
) {
  if (!hasScore) return;
  const red = '#dc2626';
  const strokeSq = '#ea580c';
  const k = scale > 0 ? scale : 1;
  if (delta < 0) {
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.arc(tcx, tcy, 22 * k, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (delta === 0) return;
  ctx.strokeStyle = strokeSq;
  ctx.lineWidth = Math.max(1.5, 2 * k);
  if (delta === 1) {
    const s = 34 * k;
    ctx.strokeRect(tcx - s / 2, tcy - s / 2, s, s);
    return;
  }
  /* +2 及以上双方框：外框放大，避免与两位数重叠 */
  const o = 50 * k;
  const inn = 34 * k;
  ctx.strokeRect(tcx - o / 2, tcy - o / 2, o, o);
  ctx.strokeRect(tcx - inn / 2, tcy - inn / 2, inn, inn);
}

function posterFitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number): string {
  const raw = String(text || '').trim() || '球手';
  ctx.font = posterFont(fontSize);
  if (maxWidth <= 0 || ctx.measureText(raw).width <= maxWidth) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s.length < raw.length ? `${s}…` : s;
}

function posterFormatSigned(d: number): string {
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
}

export async function acquireMpPosterCanvas2d(
  componentInstance?: ComponentPublicInstance | null | undefined,
  selector = '#scorePosterCanvas2d',
  orientation: PosterOrientation = 'portrait',
): Promise<{ canvas: AnyMiniCanvasNode; ctx: CanvasRenderingContext2D; dpr: number }> {
  const { width: logicalW, height: logicalH } = posterLogicalSize(orientation);

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
          let dpr = Number(uni.getSystemInfoSync().pixelRatio) || 1;
          const longSide = Math.max(logicalW, logicalH);
          if (longSide * dpr > 4096) dpr = 4096 / longSide;
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
  orientation: PosterOrientation = 'portrait',
): Promise<string> {
  await posterDelayTwoFrames();
  const { width: logicalW, height: logicalH } = posterLogicalSize(orientation);
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

export interface GroupScorePosterPlayer {
  nickname: string;
  avatar: MiniCanvasImg | null;
  total: number;
  /** 相对已录入洞标准杆之和 */
  diff: number;
  frontNine: PosterNineSummary;
  backNine: PosterNineSummary;
  getScore: (holeIndex: number) => number;
}

export interface GroupScorePoster2dImages {
  header: MiniCanvasImg | null;
  qr: MiniCanvasImg;
}

export interface GroupScorePoster2dModel {
  courseName: string;
  dateStr: string;
  players: GroupScorePosterPlayer[];
  getPar: (holeIndex: number) => number;
}

/** 单人记分卡海报 */
export function paintPersonalScorePoster2d(
  ctx: CanvasRenderingContext2D,
  images: PersonalScorePoster2dImages,
  model: PersonalScorePoster2dModel,
  orientation: PosterOrientation = 'portrait',
) {
  paintCleanScorePoster(ctx, orientation, {
    courseName: model.courseName,
    dateStr: model.dateStr,
    qr: images.qr,
    getPar: model.getPar,
    players: [
      {
        nickname: model.nickname,
        total: model.total,
        frontNine: model.frontNine,
        backNine: model.backNine,
        getScore: model.getScore,
      },
    ],
  });
}

/** 同组记分卡海报（最多 8 人） */
export function paintGroupScorePoster2d(
  ctx: CanvasRenderingContext2D,
  images: GroupScorePoster2dImages,
  model: GroupScorePoster2dModel,
  orientation: PosterOrientation = 'portrait',
) {
  paintCleanScorePoster(ctx, orientation, {
    courseName: model.courseName,
    dateStr: model.dateStr,
    qr: images.qr,
    getPar: model.getPar,
    players: model.players.slice(0, 8).map((p) => ({
      nickname: p.nickname,
      total: p.total,
      frontNine: p.frontNine,
      backNine: p.backNine,
      getScore: p.getScore,
    })),
  });
}
