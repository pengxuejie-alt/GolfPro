/**
 * 计分海报：沿用旧版球场头图、绿表、杆差符号、圆角卡片和底部总杆条。
 * 竖屏前九 / 后九上下两张表；横屏 18 洞同一张带边框的表。
 */

import type { MiniCanvasImg, PosterNineSummary, PosterOrientation } from './scorePosterMpCanvas2d';

const GREEN = '#6b9b6e';
const GREEN_LINE = '#c5dccd';
const MINT = '#ecf8ec';
const MINT_INK = '#166534';
const BANNER = '#3d8b5c';
const INK = '#1e293b';
const MUTED = '#64748b';
const RED = '#dc2626';
const SQUARE = '#ea580c';

export interface CleanPosterStat {
  birdie: number;
  eagleOrBetter: number;
  par: number;
  bogeyPlus: number;
}

export interface CleanPosterPlayer {
  nickname: string;
  avatar: MiniCanvasImg | null;
  total: number;
  diff: number;
  frontNine: PosterNineSummary;
  backNine: PosterNineSummary;
  getScore: (holeIndex: number) => number;
  stat?: CleanPosterStat | null;
}

export interface CleanPosterModel {
  courseName: string;
  dateStr: string;
  header: MiniCanvasImg | null;
  qr: MiniCanvasImg;
  players: CleanPosterPlayer[];
  getPar: (holeIndex: number) => number;
}

function fontOf(size: number, bold = false) {
  return `${bold ? 'bold ' : ''}${size}px "PingFang SC", system-ui, -apple-system, sans-serif`;
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

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = fontOf(size, true);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 24, 14, 0.78)';
  ctx.lineWidth = Math.max(3, size / 10);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundPath(ctx, x, y, w, h, r);
  ctx.stroke();
}

function signedPlain(d: number | null | undefined, played = 1): string {
  if (!played || d == null || Number.isNaN(d)) return '0';
  if (d === 0) return '0';
  return d > 0 ? `+${d}` : `${d}`;
}

function holeDiffText(score: number, par: number): { text: string; delta: number; played: boolean } {
  if (!(score > 0)) return { text: '—', delta: 0, played: false };
  const delta = score - par;
  return { text: delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`, delta, played: true };
}

/** 低于标准杆红圆，+1 橙方框，+2 及以上双方框 */
function drawScoreMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, delta: number, k: number) {
  if (delta < 0) {
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(cx, cy, 15 * k, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (delta === 0) return;
  ctx.strokeStyle = SQUARE;
  ctx.lineWidth = Math.max(1.5, 2 * k);
  if (delta === 1) {
    const s = 26 * k;
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    return;
  }
  const outer = 34 * k;
  const inner = 24 * k;
  ctx.strokeRect(cx - outer / 2, cy - outer / 2, outer, outer);
  ctx.strokeRect(cx - inner / 2, cy - inner / 2, inner, inner);
}

interface GridCell {
  text: string;
  color: string;
  bold?: boolean;
  /** 有成绩时绘制杆差符号 */
  delta?: number;
  played?: boolean;
}

function drawBorderedGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  labelW: number,
  colW: number,
  rowH: number[],
  rows: GridCell[][],
  bgs: string[],
  fontSize: number,
): number {
  const cols = rows[0]?.length ?? 0;
  const totalW = labelW + colW * Math.max(0, cols - 1);
  let yy = y;
  for (let r = 0; r < rows.length; r++) {
    const rh = rowH[r] ?? rowH[rowH.length - 1] ?? 32;
    ctx.fillStyle = bgs[r] ?? '#ffffff';
    ctx.fillRect(x, yy, totalW, rh);
    let xx = x;
    for (let c = 0; c < cols; c++) {
      const cw = c === 0 ? labelW : colW;
      const cell = rows[r]![c]!;
      const cx = xx + cw / 2;
      const cy = yy + rh / 2;
      const k = Math.min(1, (cw - 8) / 42, (rh - 6) / 42);
      if (cell.played && cell.delta != null) drawScoreMark(ctx, cx, cy, cell.delta, Math.max(0.55, k));
      const onRed = cell.played && cell.delta != null && cell.delta < 0;
      ctx.font = fontOf(onRed && String(cell.text).length >= 3 ? fontSize - 2 : fontSize, cell.bold !== false);
      ctx.fillStyle = onRed ? '#ffffff' : cell.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cell.text, cx, cy);
      xx += cw;
    }
    yy += rh;
  }
  const gridH = yy - y;
  ctx.save();
  ctx.strokeStyle = GREEN_LINE;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.rect(x, y, totalW, gridH);
  let lineY = y;
  for (let r = 0; r < rows.length - 1; r++) {
    lineY += rowH[r] ?? 32;
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + totalW, lineY);
  }
  let lineX = x + labelW;
  ctx.moveTo(lineX, y);
  ctx.lineTo(lineX, y + gridH);
  for (let c = 1; c < cols - 1; c++) {
    lineX += colW;
    ctx.moveTo(lineX, y);
    ctx.lineTo(lineX, y + gridH);
  }
  ctx.stroke();
  ctx.restore();
  return yy;
}

function paintHeaderBackdrop(ctx: CanvasRenderingContext2D, header: MiniCanvasImg | null, w: number, headH: number, pageH: number) {
  if (header) {
    ctx.drawImage(header as unknown as CanvasImageSource, 0, 0, w, headH);
  } else {
    const bg = ctx.createLinearGradient(0, 0, w, headH);
    bg.addColorStop(0, '#1a4d38');
    bg.addColorStop(1, '#8fb89a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, headH);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, headH);
  shade.addColorStop(0, 'rgba(0, 16, 10, 0.55)');
  shade.addColorStop(0.55, 'rgba(0, 28, 18, 0.28)');
  shade.addColorStop(1, 'rgba(0, 38, 24, 0.08)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, headH);
  const featherY = headH - 36;
  const body = ctx.createLinearGradient(0, featherY, 0, Math.min(pageH, headH + 48));
  body.addColorStop(0, 'rgba(255,255,255,0)');
  body.addColorStop(1, '#ffffff');
  ctx.fillStyle = body;
  ctx.fillRect(0, featherY, w, pageH - featherY);
}

function drawAvatar(ctx: CanvasRenderingContext2D, img: MiniCanvasImg, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img as unknown as CanvasImageSource, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawQrBlock(ctx: CanvasRenderingContext2D, qr: MiniCanvasImg, x: number, y: number, size: number) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(qr as unknown as CanvasImageSource, x, y, size, size);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#475569';
  ctx.font = fontOf(Math.max(16, Math.round(size * 0.16)));
  ctx.fillText('长按识别小程序码', x + size + 16, y + size * 0.36);
  ctx.fillStyle = MUTED;
  ctx.font = fontOf(Math.max(14, Math.round(size * 0.14)));
  ctx.fillText('记录每一次挥杆时刻', x + size + 16, y + size * 0.66);
}

function drawTotalBanner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  total: number,
  front: string,
  back: string,
  totalDiff: string,
) {
  ctx.fillStyle = BANNER;
  fillRound(ctx, x, y, w, h, 18);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  haloText(ctx, `${total || 0}`, x + 28, y + h * 0.62, Math.min(64, Math.round(h * 0.5)), '#ffffff', 'left');
  ctx.font = fontOf(Math.max(16, Math.round(h * 0.18)));
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('总杆', x + 28, y + h * 0.84);
  const rx = x + w - 28;
  ctx.textAlign = 'right';
  ctx.font = fontOf(Math.max(18, Math.round(h * 0.2)), true);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${front} (OUT) + ${back} (IN)`, rx, y + h * 0.42);
  ctx.font = fontOf(Math.max(16, Math.round(h * 0.17)));
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(`与标准杆差 ${totalDiff}`, rx, y + h * 0.72);
}

function estimateCardHeight(landscape: boolean, single: boolean, playerCount: number): number {
  if (single) {
    return landscape ? 268 : 560;
  }
  const row = landscape ? 40 : 38;
  const block = (landscape ? 72 : 80) + playerCount * row;
  return landscape ? 20 + block : 24 + block * 2;
}

function sumPar(getPar: (i: number) => number, start: number, count: number) {
  let s = 0;
  for (let i = 0; i < count; i++) s += Number(getPar(start + i) || 0);
  return s;
}

export function paintCleanScorePoster(
  ctx: CanvasRenderingContext2D,
  orientation: PosterOrientation,
  model: CleanPosterModel,
) {
  const landscape = orientation === 'landscape';
  const w = landscape ? 1334 : 750;
  const h = landscape ? 750 : 1334;
  const players = model.players.slice(0, 8);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (!players.length) return;

  const single = players.length === 1;
  const headH = landscape ? (single ? 210 : 188) : players.length >= 5 ? 300 : 372;
  paintHeaderBackdrop(ctx, model.header, w, headH, h);

  const cardLeft = landscape ? 20 : 18;
  const cardRight = w - cardLeft;
  const infoW = Math.min(landscape ? 780 : 530, w - 210);
  ctx.fillStyle = 'rgba(5, 28, 18, 0.55)';
  fillRound(ctx, 16, landscape ? 16 : 28, infoW, headH - (landscape ? 36 : 52), 18);

  const title = 'Golfdate计分';
  const titleSize = landscape ? 40 : 48;
  haloText(ctx, title, 36, landscape ? 64 : 86, titleSize, '#ffffff');
  ctx.font = fontOf(titleSize, true);
  const underlineW = Math.max(220, ctx.measureText(title).width);
  ctx.strokeStyle = '#c8f565';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(36, landscape ? 78 : 102);
  ctx.lineTo(36 + underlineW, landscape ? 78 : 102);
  ctx.stroke();

  haloText(ctx, '挥杆 · 记录 · 超越', 36, landscape ? 104 : 136, landscape ? 16 : 18, 'rgba(255,255,255,0.96)');
  const metaMax = infoW - 56;
  haloText(ctx, fitLine(ctx, model.courseName || '球场', metaMax, landscape ? 18 : 22, true), 36, landscape ? 130 : 172, landscape ? 18 : 22, '#ffffff');
  haloText(ctx, fitLine(ctx, model.dateStr || '', metaMax, landscape ? 16 : 18, false), 36, landscape ? 154 : 204, landscape ? 16 : 18, 'rgba(255,255,255,0.94)');

  const lead = players[0]!;
  if (single) {
    const avR = landscape ? 26 : 36;
    const avCy = headH - (landscape ? 36 : 48);
    if (lead.avatar) {
      drawAvatar(ctx, lead.avatar, landscape ? 64 : 78, avCy, avR);
      haloText(
        ctx,
        fitLine(ctx, lead.nickname || '球手', 280, landscape ? 22 : 28, true),
        landscape ? 100 : 128,
        avCy + (landscape ? 8 : 10),
        landscape ? 22 : 28,
        '#ffffff',
      );
    } else {
      haloText(ctx, fitLine(ctx, lead.nickname || '球手', 320, landscape ? 22 : 28, true), 36, avCy + 8, landscape ? 22 : 28, '#ffffff');
    }
    haloText(ctx, '总杆', w - 36, landscape ? 108 : 168, landscape ? 18 : 22, 'rgba(255,255,255,0.92)', 'right');
    haloText(ctx, `${lead.total || 0}`, w - 36, landscape ? 172 : headH - 52, landscape ? 56 : 72, '#ffffff', 'right');
  } else {
    const names = players.map((p) => p.nickname || '球手').join(' · ');
    haloText(ctx, fitLine(ctx, names, infoW - 48, landscape ? 18 : 20, true), 36, headH - (landscape ? 28 : 40), landscape ? 18 : 20, '#ffffff');
    haloText(ctx, '同组', w - 36, landscape ? 108 : 168, landscape ? 18 : 22, 'rgba(255,255,255,0.92)', 'right');
    haloText(ctx, `${players.length}`, w - 36, landscape ? 168 : headH - 56, landscape ? 52 : 64, '#ffffff', 'right');
  }

  const qrSize = landscape ? 96 : 128;
  const bannerH = landscape ? 88 : 118;
  const footerBlock = bannerH + 14 + qrSize + (landscape ? 20 : 36);
  const cardTop = headH + (landscape ? 8 : 12);
  const cardBottomLimit = h - footerBlock;
  const cardH = Math.min(cardBottomLimit - cardTop, estimateCardHeight(landscape, single, players.length));
  ctx.fillStyle = '#ffffff';
  fillRound(ctx, cardLeft, cardTop, cardRight - cardLeft, cardH, 22);
  ctx.strokeStyle = '#d5e0dc';
  ctx.lineWidth = 1.5;
  strokeRound(ctx, cardLeft, cardTop, cardRight - cardLeft, cardH, 22);

  const innerX = cardLeft + (landscape ? 14 : 16);
  const innerW = cardRight - cardLeft - (landscape ? 28 : 32);
  let y = cardTop + (landscape ? 12 : 16);

  if (single) {
    y = paintPersonalCard(ctx, model, lead, landscape, innerX, y, innerW, cardTop + cardH - 14);
  } else {
    y = paintGroupCard(ctx, model, players, landscape, innerX, y, innerW, cardTop + cardH - 12);
  }

  const bannerY = Math.min(y + 12, h - footerBlock + 4);
  const front = signedPlain(lead.frontNine.diff, lead.frontNine.played);
  const back = signedPlain(lead.backNine.diff, lead.backNine.played);
  const allDiff = signedPlain(
    players.reduce((s, p) => s + (p.frontNine.played + p.backNine.played > 0 ? p.diff : 0), 0),
    players.some((p) => p.frontNine.played + p.backNine.played > 0) ? 1 : 0,
  );
  if (single) {
    drawTotalBanner(
      ctx,
      cardLeft,
      bannerY,
      cardRight - cardLeft,
      bannerH,
      lead.total,
      front,
      back,
      signedPlain(lead.diff, lead.frontNine.played + lead.backNine.played),
    );
  } else {
    ctx.fillStyle = BANNER;
    fillRound(ctx, cardLeft, bannerY, cardRight - cardLeft, bannerH, 18);
    haloText(ctx, `${players.length}`, cardLeft + 28, bannerY + bannerH * 0.62, Math.min(56, Math.round(bannerH * 0.46)), '#ffffff');
    ctx.font = fontOf(Math.max(16, Math.round(bannerH * 0.18)));
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('同组', cardLeft + 28, bannerY + bannerH * 0.84);
    const nameLine = fitLine(ctx, players.map((p) => p.nickname || '球手').join(' · '), cardRight - cardLeft - 180, 18, true);
    ctx.textAlign = 'right';
    ctx.font = fontOf(Math.max(16, Math.round(bannerH * 0.18)), true);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(nameLine, cardRight - 28, bannerY + bannerH * 0.46);
    ctx.font = fontOf(Math.max(15, Math.round(bannerH * 0.16)));
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(`总差 ${allDiff}`, cardRight - 28, bannerY + bannerH * 0.74);
  }
  drawQrBlock(ctx, model.qr, cardLeft + 8, bannerY + bannerH + 12, qrSize);
}

function paintPersonalCard(
  ctx: CanvasRenderingContext2D,
  model: CleanPosterModel,
  player: CleanPosterPlayer,
  landscape: boolean,
  x: number,
  y: number,
  width: number,
  yMax: number,
): number {
  const front = signedPlain(player.frontNine.diff, player.frontNine.played);
  const back = signedPlain(player.backNine.diff, player.backNine.played);
  const totalDiff = signedPlain(player.diff, player.frontNine.played + player.backNine.played);
  ctx.textBaseline = 'middle';
  ctx.font = fontOf(landscape ? 16 : 18, true);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.fillText(`前九 ${front}`, x, y + 12);
  ctx.fillText(`后九 ${back}`, x + (landscape ? 160 : 150), y + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`总差 ${totalDiff}`, x + width, y + 12);
  y += landscape ? 28 : 36;

  const labelW = landscape ? 64 : 62;
  const fontSize = landscape ? 15 : 16;

  const drawNine = (start: number, count: number, title: string, boxX: number, boxW: number, top: number) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = fontOf(landscape ? 16 : 18, true);
    ctx.fillText(title, boxX, top + 16);
    const gridTop = top + (landscape ? 24 : 28);
    const colW = (boxW - labelW) / count;
    const avail = yMax - gridTop;
    const base = landscape ? [30, 26, 26, 48] : [40, 32, 32, 60];
    const baseSum = base.reduce((s, n) => s + n, 0);
    const scale = Math.min(1, avail / baseSum);
    const rowH = base.map((n) => Math.max(22, Math.round(n * scale)));
    const holeCells: GridCell[] = [{ text: '洞数', color: '#ffffff', bold: true }];
    const parCells: GridCell[] = [{ text: '标准杆', color: MINT_INK, bold: true }];
    const scoreCells: GridCell[] = [{ text: '杆数', color: INK, bold: true }];
    const diffCells: GridCell[] = [{ text: '杆差', color: MUTED, bold: true }];
    for (let i = 0; i < count; i++) {
      const hi = start + i;
      const par = Number(model.getPar(hi) || 0);
      const sc = Number(player.getScore(hi) || 0);
      const diff = holeDiffText(sc, par);
      holeCells.push({ text: `${hi + 1}`, color: '#ffffff', bold: true });
      parCells.push({ text: `${par}`, color: MINT_INK, bold: true });
      scoreCells.push({ text: sc > 0 ? `${sc}` : '—', color: sc > 0 ? INK : '#94a3b8', bold: true });
      diffCells.push({
        text: diff.text,
        color: diff.played ? INK : '#94a3b8',
        bold: true,
        delta: diff.delta,
        played: diff.played,
      });
    }
    return drawBorderedGrid(
      ctx,
      boxX,
      gridTop,
      labelW,
      colW,
      rowH,
      [holeCells, parCells, scoreCells, diffCells],
      [GREEN, MINT, '#fafafa', '#ffffff'],
      fontSize,
    );
  };

  if (landscape) {
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = fontOf(16, true);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('前九 · OUT', x, y + 16);
    ctx.textAlign = 'right';
    ctx.fillText('后九 · IN', x + width, y + 16);
    y += 24;
    const colW = (width - labelW) / 18;
    const gridTop = y;
    const avail = Math.max(120, yMax - gridTop);
    const base = [30, 26, 26, 50];
    const scale = Math.min(1, avail / base.reduce((s, n) => s + n, 0));
    const rowH = base.map((n) => Math.max(22, Math.round(n * scale)));
    const holeCells: GridCell[] = [{ text: '洞数', color: '#ffffff', bold: true }];
    const parCells: GridCell[] = [{ text: '标准杆', color: MINT_INK, bold: true }];
    const scoreCells: GridCell[] = [{ text: '杆数', color: INK, bold: true }];
    const diffCells: GridCell[] = [{ text: '杆差', color: MUTED, bold: true }];
    for (let hi = 0; hi < 18; hi++) {
      const par = Number(model.getPar(hi) || 0);
      const sc = Number(player.getScore(hi) || 0);
      const diff = holeDiffText(sc, par);
      holeCells.push({ text: `${hi + 1}`, color: '#ffffff', bold: true });
      parCells.push({ text: `${par}`, color: MINT_INK, bold: true });
      scoreCells.push({ text: sc > 0 ? `${sc}` : '—', color: sc > 0 ? INK : '#94a3b8', bold: true });
      diffCells.push({ text: diff.text, color: diff.played ? INK : '#94a3b8', bold: true, delta: diff.delta, played: diff.played });
    }
    y = drawBorderedGrid(ctx, x, gridTop, labelW, colW, rowH, [holeCells, parCells, scoreCells, diffCells], [GREEN, MINT, '#fafafa', '#ffffff'], fontSize);
    const splitX = x + labelW + colW * 9;
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(splitX, gridTop);
    ctx.lineTo(splitX, y);
    ctx.stroke();
  } else {
    y = drawNine(0, 9, '前九 · OUT', x, width, y) + 14;
    y = drawNine(9, 9, '后九 · IN', x, width, y);
  }

  if (player.stat) {
    y += landscape ? 8 : 14;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = fontOf(landscape ? 15 : 18);
    const s = player.stat;
    ctx.fillText(`老鹰+ ${s.eagleOrBetter}洞 · 小鸟 ${s.birdie}洞`, x, y + 16);
    ctx.fillText(`保帕 ${s.par}洞 · 柏忌+ ${s.bogeyPlus}洞`, x, y + (landscape ? 36 : 42));
    y += landscape ? 44 : 52;
  }
  return y;
}

function paintGroupCard(
  ctx: CanvasRenderingContext2D,
  model: CleanPosterModel,
  players: CleanPosterPlayer[],
  landscape: boolean,
  x: number,
  y: number,
  width: number,
  yMax: number,
): number {
  const labelW = landscape ? 132 : 118;
  const fontSize = landscape ? 14 : 15;

  const drawBlock = (start: number, count: number, title: string, sumKey: 'frontNine' | 'backNine', boxX: number, boxW: number, top: number, rowH: number) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = fontOf(landscape ? 15 : 17, true);
    ctx.fillText(title, boxX, top + 15);
    const gridTop = top + 22;
    const colW = (boxW - labelW) / (count + 1);
    const holeRow: GridCell[] = [{ text: '球手', color: '#ffffff', bold: true }];
    const parRow: GridCell[] = [{ text: '标准杆', color: MINT_INK, bold: true }];
    for (let i = 0; i < count; i++) {
      holeRow.push({ text: `${start + i + 1}`, color: '#ffffff', bold: true });
      parRow.push({ text: `${Number(model.getPar(start + i) || 0)}`, color: MINT_INK, bold: true });
    }
    holeRow.push({ text: sumKey === 'frontNine' ? 'OUT' : 'IN', color: '#ffffff', bold: true });
    parRow.push({ text: `${sumPar(model.getPar, start, count)}`, color: MINT_INK, bold: true });
    const body: GridCell[][] = [];
    const bgs = [GREEN, MINT];
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi]!;
      const nine = p[sumKey];
      const cells: GridCell[] = [{ text: fitLine(ctx, p.nickname || '球手', labelW - 10, fontSize, true), color: INK, bold: true }];
      for (let i = 0; i < count; i++) {
        const hi = start + i;
        const diff = holeDiffText(Number(p.getScore(hi) || 0), Number(model.getPar(hi) || 0));
        cells.push({ text: diff.text, color: diff.played ? INK : '#94a3b8', bold: true, delta: diff.delta, played: diff.played });
      }
      const sumText = signedPlain(nine.diff, nine.played);
      cells.push({ text: sumText, color: nine.played && nine.diff != null && nine.diff < 0 ? '#15803d' : nine.played && nine.diff != null && nine.diff > 0 ? RED : INK, bold: true });
      body.push(cells);
      bgs.push(pi % 2 === 1 ? '#f3faf4' : '#ffffff');
    }
    const heights = [landscape ? 26 : 30, landscape ? 24 : 28, ...players.map(() => rowH)];
    const end = drawBorderedGrid(ctx, boxX, gridTop, labelW, colW, heights, [holeRow, parRow, ...body], bgs, fontSize);
    const sumX = boxX + labelW + colW * count;
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sumX, gridTop);
    ctx.lineTo(sumX, end);
    ctx.stroke();
    return end;
  };

  if (landscape) {
    const gap = 12;
    const boxW = (width - gap) / 2;
    const headerH = 22 + 26 + 24;
    const rowH = Math.max(28, Math.min(48, Math.floor((yMax - y - headerH - 8) / players.length)));
    const leftEnd = drawBlock(0, 9, '前九 · OUT', 'frontNine', x, boxW, y, rowH);
    const rightEnd = drawBlock(9, 9, '后九 · IN', 'backNine', x + boxW + gap, boxW, y, rowH);
    return Math.max(leftEnd, rightEnd);
  }

  const headerH = 22 + 30 + 28;
  const gap = 12;
  const rowH = Math.max(28, Math.min(46, Math.floor((yMax - y - headerH * 2 - gap) / (players.length * 2))));
  y = drawBlock(0, 9, '前九 · OUT', 'frontNine', x, width, y, rowH) + gap;
  return drawBlock(9, 9, '后九 · IN', 'backNine', x, width, y, rowH);
}
