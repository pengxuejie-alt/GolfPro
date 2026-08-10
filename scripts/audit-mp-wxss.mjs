/**
 * 只读审计：扫描 dist 下微信小程序产物中的 WXSS/WCSS，不修改任何文件。
 * 发现 *、\、oklch、oklab、现代 rgb(… / …) 等可疑片段时，在终端高亮打印路径、行号与片段。
 *
 * 用法：npm run audit:mp-wxss
 *        npm run audit:mp-wxss -- --dev   （额外扫描 dist/dev/mp-weixin，可能与 build 不一致、误报较多）
 *
 * ── 与微信报错「error at token 0」等配合（自动反馈循环）──
 * 1) 开发者工具报错里若有文件路径与行号（多为 app.wxss 或页面 wxss），用编辑器打开对应 dist 文件跳到该行。
 * 2) 查看该行附近的选择器（如 .bg-red-500/20、.z-\\[60\\]），把「类名」复制出来。
 * 3) 在 src 里全文搜索该 class（Vue 里 class="..." 或 :class），即可定位到 Tailwind 类名来源。
 * 4) 若行号指向压缩单行，可先运行本脚本看是否已扫出同类问题；或用格式化工具将 wxss 换行后再对照。
 */
import fs from 'fs';
import path from 'path';

const R = '\x1b[31m';
const Y = '\x1b[33m';
const B = '\x1b[1m';
const D = '\x1b[0m';

const includeDev = process.argv.includes('--dev');
const ROOTS = [path.resolve('dist/build/mp-weixin')];
if (includeDev) ROOTS.push(path.resolve('dist/dev/mp-weixin'));

const PATTERNS = [
  { name: '反斜杠 \\\\', re: /\\/g },
  { name: '疑似通配符 *,', re: /\*,/g },
  { name: '疑似通配符 *{', re: /\*\s*\{/g },
  { name: 'oklch(', re: /oklch\s*\(/gi },
  { name: 'oklab(', re: /oklab\s*\(/gi },
  { name: '现代 rgb 空格+斜杠透明度', re: /rgb\s*\(\s*[^)]*\s+\/\s*[^)]+\)/gi },
  { name: '现代 rgba 空格+斜杠', re: /rgba\s*\(\s*[^)]*\s+\/\s*[^)]+\)/gi },
];

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    if (dir.endsWith('.wxss') || dir.endsWith('.css')) acc.push(dir);
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    walk(path.join(dir, name), acc);
  }
}

function auditFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const reported = new Set();

  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    const lineRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      lineRe.lastIndex = 0;
      while ((m = lineRe.exec(line)) !== null) {
        const key = `${li}:${name}:${m.index}`;
        if (reported.has(key)) continue;
        reported.add(key);
        const col = m.index + 1;
        const start = Math.max(0, m.index - 40);
        const end = Math.min(line.length, m.index + 60);
        const snippet = line.slice(start, end).replace(/\s+/g, ' ').trim();
        console.log(
          `${B}${Y}[audit-mp-wxss]${D} ${R}${name}${D}\n` +
            `  ${B}文件${D} ${path.relative(process.cwd(), file)}\n` +
            `  ${B}位置${D} 第 ${li + 1} 行, 约第 ${col} 列\n` +
            `  ${B}片段${D} …${snippet}…\n`
        );
      }
    }
  }
}

let totalFiles = 0;
let rootsFound = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  rootsFound++;
  const files = [];
  walk(root, files);
  for (const f of files) {
    totalFiles++;
    auditFile(f);
  }
}

if (rootsFound === 0) {
  console.log(`${Y}[audit-mp-wxss]${D} 未找到 dist/build/mp-weixin 或 dist/dev/mp-weixin，请先 npm run build:mp-weixin 或 dev:mp-weixin。`);
  process.exit(0);
}

console.log(`${B}[audit-mp-wxss]${D} 完成：已扫描 ${totalFiles} 个文件（${rootsFound} 个产物目录）。若上方无红/黄输出，则未命中上述规则。`);
