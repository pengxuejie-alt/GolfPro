/**
 * 从设计稿切出底部 Tab 图标（灰/绿两态），输出到 src/static/tab/
 * 可调：TOP_SKIP、ROW_H、ICON_INACTIVE / ICON_ACTIVE
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SRC = path.join(
  ROOT,
  'scripts',
  'refs',
  'tabbar-design-ref.png'
);

const OUT_DIR = path.join(ROOT, 'src', 'static', 'tab');
const OUT_SIZE = 81; // 微信小程序 tabBar 常用逻辑像素

const TOP_SKIP = 118;
const ROW_H = 432;
/** 未选中行：略矮以避开「首页」等字 */
const ICON_INACTIVE = { topInRow: 34, iconH: 172 };
/** 选中行：原图下行同样位置但需再收紧，否则会带上绿字标签 */
const ICON_ACTIVE = { topInRow: 34, iconH: 148 };
const COLS = [
  { x: 0, w: 163 },
  { x: 163, w: 163 },
  { x: 326, w: 162 },
];

const JOBS = [
  { col: 0, row: 0, name: 'home' },
  { col: 1, row: 0, name: 'players' },
  { col: 2, row: 0, name: 'me' },
  { col: 0, row: 1, name: 'home-active' },
  { col: 1, row: 1, name: 'players-active' },
  { col: 2, row: 1, name: 'me-active' },
];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('缺少参考图:', SRC);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const meta = await sharp(SRC).metadata();
  console.log('source', meta.width, meta.height);

  for (const job of JOBS) {
    const col = COLS[job.col];
    const rowY = TOP_SKIP + job.row * ROW_H;
    const box = job.row === 0 ? ICON_INACTIVE : ICON_ACTIVE;
    const top = rowY + box.topInRow;
    const left = col.x;

    const buf = await sharp(SRC)
      .extract({
        left,
        top,
        width: col.w,
        height: box.iconH,
      })
      .flatten({ background: '#ffffff' })
      .resize(OUT_SIZE, OUT_SIZE, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();

    const outPath = path.join(OUT_DIR, `${job.name}.png`);
    await fs.promises.writeFile(outPath, buf);
    console.log('wrote', path.relative(ROOT, outPath));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
