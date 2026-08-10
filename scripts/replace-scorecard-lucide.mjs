import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../src/pages/scorecard/scorecard.vue');
let s = fs.readFileSync(p, 'utf8');

const names = [
  'ChevronLeft',
  'ChevronRight',
  'Share',
  'MoreHorizontal',
  'UserPlus',
  'Minus',
  'Plus',
  'X',
  'Edit2',
  'Trash2',
  'Trophy',
  'Award',
  'Flag',
  'Check',
  'Users',
  'MessageCircle',
  'QrCode',
  'Eye',
  'User',
  'Search',
  'Settings',
  'Calculator',
  'Bomb',
  'MapPin',
  'LogOut',
];

for (const n of names) {
  const re = new RegExp(`<(${n})((?:\\s[^>]*)?)\\s*/>`, 'g');
  s = s.replace(re, (m, tag, attrs) => {
    if (/:class=/.test(attrs)) return m;
    let size = 22;
    if (/w-2\.5|h-2\.5/.test(attrs)) size = 12;
    else if (/w-3\.5|h-3\.5/.test(attrs)) size = 14;
    else if (/\bw-3\b|\bh-3\b/.test(attrs)) size = 16;
    else if (/\bw-4\b|\bh-4\b/.test(attrs)) size = 18;
    else if (/\bw-5\b|\bh-5\b/.test(attrs)) size = 20;
    else if (/\bw-6\b|\bh-6\b/.test(attrs)) size = 24;
    else if (/\bw-8\b|\bh-8\b/.test(attrs)) size = 28;
    let color = '#cbd5e1';
    if (/text-red/.test(attrs)) color = '#ef4444';
    if (/text-white/.test(attrs)) color = '#ffffff';
    if (/text-blue/.test(attrs)) color = '#60a5fa';
    if (/text-slate-400|text-slate-500/.test(attrs)) color = '#94a3b8';
    if (/text-slate-600/.test(attrs)) color = '#475569';
    if (/text-slate-900/.test(attrs)) color = '#0f172a';
    if (/text-green/.test(attrs)) color = '#4ade80';
    if (/text-orange/.test(attrs)) color = '#fb923c';
    if (/text-purple/.test(attrs)) color = '#c084fc';
    if (/text-yellow/.test(attrs)) color = '#eab308';
    return `<AppUniIcon name="${tag}" :size="${size}" color="${color}" />`;
  });
}

fs.writeFileSync(p, s);
console.log('replaced self-closing lucide in', p);
