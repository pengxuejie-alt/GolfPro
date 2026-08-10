import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const enc = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

const S = (hex) => hex.replace('#', '%23');

const SVG = {
  userPlusSlate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#94a3b8')}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  userPlusBlue: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#60a5fa')}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
  calcWhite: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#ffffff')}" stroke-width="2" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>`,
  gearSlate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#94a3b8')}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
  plusMuted: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#475569')}" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  minusMuted: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#475569')}" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  plusSlate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#cbd5e1')}" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  minusSlate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${S('#cbd5e1')}" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  bombRed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${S('#ef4444')}" stroke="${S('#991b1b')}" stroke-width="1.2" stroke-linejoin="round"><path d="M12 2.5l1.2 2.2h2.8l.8 2.4 2.2.8v2.8l2.2 1.2-1.5 2.3 1.5 2.3-2.2 1.2v2.8l-2.2.8-.8 2.4h-2.8L12 21.5l-1.2-2.2H8l-.8-2.4-2.2-.8v-2.8L1.8 12l1.5-2.3L1.8 7.4 4 6.2V3.4l2.2-.8L7 0h2.8L12 2.5z"/><circle cx="12" cy="12" r="3.5" fill="${S('#fecaca')}"/></svg>`,
  bombWhite: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${S('#ffffff')}" stroke="${S('#fecaca')}" stroke-width="1.2" stroke-linejoin="round"><path d="M12 2.5l1.2 2.2h2.8l.8 2.4 2.2.8v2.8l2.2 1.2-1.5 2.3 1.5 2.3-2.2 1.2v2.8l-2.2.8-.8 2.4h-2.8L12 21.5l-1.2-2.2H8l-.8-2.4-2.2-.8v-2.8L1.8 12l1.5-2.3L1.8 7.4 4 6.2V3.4l2.2-.8L7 0h2.8L12 2.5z"/><circle cx="12" cy="12" r="3.5" fill="${S('#fee2e2')}"/></svg>`,
};

const out = {};
for (const [k, v] of Object.entries(SVG)) {
  out[k] = enc(v);
}

const ts = `/** 计分卡核心区域用：Base64 SVG，小程序内作 background-image，避免动态 SVG 崩溃 */
export const SCORECARD_CORE_SVG = ${JSON.stringify(out, null, 2)} as const;

export type ScorecardCoreSvgKey = keyof typeof SCORECARD_CORE_SVG;
`;

const target = path.join(__dirname, '../src/utils/scorecardCoreSvg.ts');
fs.writeFileSync(target, ts, 'utf8');
console.log('Wrote', target);
