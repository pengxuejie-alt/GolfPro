/**
 * 压缩首页分享图（微信对包体敏感，分享图建议 < 400KB）
 * 用法:
 *   node scripts/compress-share-cover.mjs
 *   node scripts/compress-share-cover.mjs path/to/high-res.png
 *
 * 若有更高清替换图，可命名为 src/static/share-home-cover-src.png 再运行本脚本（无需传参）。
 */
import { existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const output = join(root, 'src/static/share-home-cover.jpg');

function resolveInput() {
  const fromCli = process.argv[2];
  if (fromCli) return join(process.cwd(), fromCli);
  const srcPng = join(root, 'src/static/share-home-cover-src.png');
  if (existsSync(srcPng)) return srcPng;
  const curJpg = join(root, 'src/static/share-home-cover.jpg');
  if (existsSync(curJpg)) return curJpg;
  return '';
}

async function main() {
  const input = resolveInput();
  if (!input) {
    console.error('未找到源图。请放置 src/static/share-home-cover-src.png 或传入图片路径。');
    process.exit(1);
  }
  const buf = await sharp(input)
    .rotate()
    .resize(500, 400, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  const { writeFileSync } = await import('fs');
  writeFileSync(output, buf);
  const kb = (statSync(output).size / 1024).toFixed(1);
  console.log('OK', output, kb + 'KB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
