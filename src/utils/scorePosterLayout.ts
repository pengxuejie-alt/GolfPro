/**
 * 计分海报版式（参考常见记分卡）：白底、姓名/球场/时间居中。
 * 横屏：18 洞同一行，列含 OUT / IN / TOT。
 * 竖屏：前九 + OUT，其下后九 + IN / TOT。
 * 洞格为相对标准杆的杆差；小于标准杆画蓝圈。OUT/IN 为半场杆差，TOT 为总杆。
 */

import type { MiniCanvasImg, PosterNineSummary, PosterOrientation } from './scorePosterMpCanvas2d';

const BLUE = '#3a6cf6';
const INK = '#111111';
const SCORE = '#1f2937';
const MUTED = '#6b7280';
const DATE = '#9ca3af';
const HOLE = '#c5c8ce';
const STRIPE = '#f3f5f8';
const EMPTY = '#d1d5db';

export interface CleanPosterPlayer {
  nickname: string;
  total: number;
  frontNine: PosterNineSummary;
  backNine: PosterNineSummary;
  getScore: (holeIndex: number) => number;
}

export interface CleanPosterModel {
  courseName: string;
  dateStr: string;
  qr: MiniCanvasImg;
  players: CleanPosterPlayer[];
  getPar: (holeIndex: number) => number;
}

type PosterCol = { t: 'hole'; i: number } | { t: 'out' } | { t: 'in' } | { t: 'tot' };

function fontOf(size: number, bold = false) {
  const weight = bold ? 'bold ' : '';
  return `${weight}${size}px "PingFang SC", system-ui, -apple-system, sans-serif`;
}

function fitLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, bold: boolean): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  ctx.font = fontOf(size, bold);
  if (maxWidth <= 0 || ctx.measureText(raw).width <= maxWidth) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return s.length < raw.length ? `${s}…` : s;
}

/** 以 top 为字顶绘制居中文字，返回下一行可用的 y */
function drawCenterLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  top: number,
  maxWidth: number,
  startSize: number,
  minSize: number,
  color: string,
  bold: boolean,
): number {
  const raw = String(text || '').trim();
  if (!raw) return top;
  let size = startSize;
  ctx.font = fontOf(size, bold);
  while (size > minSize && ctx.measureText(raw).width > maxWidth) {
    size -= 1;
    ctx.font = fontOf(size, bold);
  }
  const shown = fitLine(ctx, raw, maxWidth, size, bold);
  const cy = top + size / 2 + 1;
  ctx.font = fontOf(size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, cx, cy);
  return Math.round(cy + size / 2 + 1);
}

function fillCenter(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
  bold = false,
) {
  ctx.font = fontOf(size, bold);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

function signedDiff(d: number): string {
  if (d === 0) return '0';
  return d > 0 ? `+${d}` : `${d}`;
}

function nineDiffText(s: PosterNineSummary): string {
  if (!s.played || s.diff == null) return '—';
  return signedDiff(s.diff);
}

function sumPar(getPar: (i: number) => number, start: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += Number(getPar(start + i) || 0);
  return sum;
}

function drawRoundQr(ctx: CanvasRenderingContext2D, qr: MiniCanvasImg, cx: number, cy: number, size: number) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(qr as unknown as CanvasImageSource, x, y, size, size);
  ctx.restore();
}

function drawScoreTable(
  ctx: CanvasRenderingContext2D,
  model: CleanPosterModel,
  players: CleanPosterPlayer[],
  cols: PosterCol[],
  top: number,
  rowH: number,
  padX: number,
  nameW: number,
  holesW: number,
  holeRowH: number,
  parRowH: number,
  nameSize: number,
  cellSize: number,
): number {
  const holesLeft = padX + nameW;
  const colW = holesW / cols.length;
  const contentW = nameW + holesW;
  const parFront = sumPar(model.getPar, 0, 9);
  const parBack = sumPar(model.getPar, 9, 9);
  const parAll = parFront + parBack;

  let yy = top;
  for (let c = 0; c < cols.length; c++) {
    const col = cols[c]!;
    const cx = holesLeft + c * colW + colW / 2;
    const cy = yy + holeRowH / 2;
    if (col.t === 'hole') {
      fillCenter(ctx, `${col.i + 1}`, cx, cy, cellSize, HOLE);
    } else {
      const label = col.t === 'out' ? 'OUT' : col.t === 'in' ? 'IN' : 'TOT';
      fillCenter(ctx, label, cx, cy, cellSize, BLUE, true);
    }
  }
  yy += holeRowH;

  for (let c = 0; c < cols.length; c++) {
    const col = cols[c]!;
    const cx = holesLeft + c * colW + colW / 2;
    const cy = yy + parRowH / 2;
    if (col.t === 'hole') {
      fillCenter(ctx, `${Number(model.getPar(col.i) || 0)}`, cx, cy, cellSize, HOLE);
    } else if (col.t === 'out') {
      fillCenter(ctx, `${parFront}`, cx, cy, cellSize, BLUE, true);
    } else if (col.t === 'in') {
      fillCenter(ctx, `${parBack}`, cx, cy, cellSize, BLUE, true);
    } else {
      fillCenter(ctx, `${parAll}`, cx, cy, cellSize, BLUE, true);
    }
  }
  yy += parRowH;

  for (let pi = 0; pi < players.length; pi++) {
    const player = players[pi]!;
    if (pi % 2 === 1) {
      ctx.fillStyle = STRIPE;
      ctx.fillRect(padX, yy, contentW, rowH);
    }
    const cy = yy + rowH / 2;
    const name = fitLine(ctx, player.nickname || '球手', nameW - 12, nameSize, true) || '球手';
    ctx.font = fontOf(nameSize, true);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, padX + 2, cy);

    const playedAll = player.frontNine.played + player.backNine.played;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c]!;
      const cx = holesLeft + c * colW + colW / 2;
      if (col.t === 'hole') {
        const sc = Number(player.getScore(col.i) || 0);
        const par = Number(model.getPar(col.i) || 0);
        const delta = sc > 0 ? sc - par : 0;
        const text = sc > 0 ? signedDiff(delta) : '—';
        if (sc > 0 && delta < 0) {
          const r = Math.max(11, Math.min(colW * 0.36, rowH * 0.34, 16));
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = BLUE;
          ctx.lineWidth = 1.75;
          ctx.stroke();
          fillCenter(ctx, text, cx, cy, text.length >= 3 ? cellSize - 2 : cellSize, BLUE, true);
        } else {
          fillCenter(ctx, text, cx, cy, cellSize, sc > 0 ? SCORE : EMPTY, sc > 0);
        }
        continue;
      }
      let text = '—';
      let empty = true;
      if (col.t === 'out') {
        text = nineDiffText(player.frontNine);
        empty = text === '—';
      } else if (col.t === 'in') {
        text = nineDiffText(player.backNine);
        empty = text === '—';
      } else if (playedAll > 0) {
        text = `${player.total || 0}`;
        empty = false;
      }
      fillCenter(ctx, text, cx, cy, cellSize + (col.t === 'tot' ? 1 : 0), empty ? EMPTY : BLUE, !empty);
    }
    yy += rowH;
  }
  return yy;
}

export function paintCleanScorePoster(
  ctx: CanvasRenderingContext2D,
  orientation: PosterOrientation,
  model: CleanPosterModel,
) {
  const w = orientation === 'landscape' ? 1334 : 750;
  const h = orientation === 'landscape' ? 750 : 1334;
  const players = model.players.slice(0, 8);
  const landscape = orientation === 'landscape';

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (!players.length) return;

  const padX = landscape ? 28 : 22;
  const nameW = landscape ? 158 : 126;
  const contentW = w - padX * 2;
  const holesW = contentW - nameW;
  const maxTextW = contentW;

  let y = landscape ? 34 : 48;
  const names = players.map((p) => String(p.nickname || '').trim() || '球手').join('、');
  y = drawCenterLine(ctx, names, w / 2, y, maxTextW, landscape ? 30 : 32, 16, INK, true);
  y += landscape ? 16 : 18;
  y = drawCenterLine(ctx, model.courseName || '球场', w / 2, y, maxTextW, landscape ? 18 : 20, 13, MUTED, false);
  y += landscape ? 10 : 12;
  y = drawCenterLine(ctx, model.dateStr || '', w / 2, y, maxTextW, landscape ? 16 : 17, 12, DATE, false);
  y += landscape ? 26 : 34;

  const qrSize = landscape ? 108 : 136;
  const captionH = 22;
  const bottomPad = landscape ? 26 : 40;
  const bottomReserve = bottomPad + qrSize + 12 + captionH;
  const tableBottomLimit = h - bottomReserve;

  const holeRowH = landscape ? 30 : 34;
  const parRowH = landscape ? 28 : 32;
  const cellSize = landscape ? 15 : 16;
  const nameSize = landscape ? 16 : 17;

  if (landscape) {
    const cols: PosterCol[] = [];
    for (let i = 0; i < 9; i++) cols.push({ t: 'hole', i });
    cols.push({ t: 'out' });
    for (let i = 9; i < 18; i++) cols.push({ t: 'hole', i });
    cols.push({ t: 'in' });
    cols.push({ t: 'tot' });
    const fixed = holeRowH + parRowH;
    const avail = Math.max(players.length * 32, tableBottomLimit - y);
    let rowH = Math.floor((avail - fixed) / players.length);
    rowH = Math.max(34, Math.min(54, rowH));
    const need = fixed + players.length * rowH;
    if (y + need > tableBottomLimit) {
      rowH = Math.max(30, Math.floor((tableBottomLimit - y - fixed) / players.length));
    }
    drawScoreTable(ctx, model, players, cols, y, rowH, padX, nameW, holesW, holeRowH, parRowH, nameSize, cellSize);
  } else {
    const front: PosterCol[] = [];
    for (let i = 0; i < 9; i++) front.push({ t: 'hole', i });
    front.push({ t: 'out' });
    const back: PosterCol[] = [];
    for (let i = 9; i < 18; i++) back.push({ t: 'hole', i });
    back.push({ t: 'in' });
    back.push({ t: 'tot' });
    const gap = 40;
    const fixed = (holeRowH + parRowH) * 2 + gap;
    const avail = Math.max(players.length * 2 * 32, tableBottomLimit - y);
    let rowH = Math.floor((avail - fixed) / (players.length * 2));
    rowH = Math.max(36, Math.min(56, rowH));
    const need = fixed + players.length * 2 * rowH;
    if (y + need > tableBottomLimit) {
      rowH = Math.max(30, Math.floor((tableBottomLimit - y - fixed) / (players.length * 2)));
    }
    const after = drawScoreTable(
      ctx,
      model,
      players,
      front,
      y,
      rowH,
      padX,
      nameW,
      holesW,
      holeRowH,
      parRowH,
      nameSize,
      cellSize,
    );
    drawScoreTable(
      ctx,
      model,
      players,
      back,
      after + gap,
      rowH,
      padX,
      nameW,
      holesW,
      holeRowH,
      parRowH,
      nameSize,
      cellSize,
    );
  }

  const qrCy = h - bottomPad - captionH - 12 - qrSize / 2;
  drawRoundQr(ctx, model.qr, w / 2, qrCy, qrSize);
  ctx.font = fontOf(landscape ? 15 : 16);
  ctx.fillStyle = DATE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Golfdate计分', w / 2, h - bottomPad - captionH / 2);
}
