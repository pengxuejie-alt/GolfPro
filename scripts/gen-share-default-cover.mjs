import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '../src/static/share-home-cover.jpg');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">
<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
<stop offset="0%" style="stop-color:#0d9488"/><stop offset="100%" style="stop-color:#0f172a"/></linearGradient></defs>
<rect width="500" height="400" fill="url(#g)"/>
<text x="250" y="175" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-size="30" font-weight="700">Golfdate</text>
<text x="250" y="215" text-anchor="middle" fill="#99f6e4" font-family="system-ui,sans-serif" font-size="17">高尔夫计分助手</text>
</svg>`;

const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
writeFileSync(out, buf);
console.log('share-home-cover.jpg', (buf.length / 1024).toFixed(1), 'KB');
