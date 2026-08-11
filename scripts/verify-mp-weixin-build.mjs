/**
 * 上传前校验：确认 dist 产物含预期版本与关键功能代码，避免误传旧目录。
 *
 * 用法：
 *   npm run verify:mp-weixin          # 仅校验 dist/build（上传推荐）
 *   npm run verify:mp-weixin -- --dev # 额外校验 dist/dev（开发目录）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const includeDev = process.argv.includes('--dev');
const targets = [
  { label: 'build（上传用）', dir: path.join(root, 'dist/build/mp-weixin') },
];
if (includeDev) {
  targets.push({ label: 'dev（开发用）', dir: path.join(root, 'dist/dev/mp-weixin') });
}

function readManifestVersion() {
  const manifestPath = path.join(root, 'src/manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return {
    versionName: String(raw.versionName ?? '').trim(),
    versionCode: String(raw.versionCode ?? '').trim(),
  };
}

function checkDir(label, dir, expected) {
  const errors = [];
  if (!fs.existsSync(dir)) {
    errors.push(`目录不存在：${path.relative(root, dir)}`);
    return errors;
  }

  const vendorPath = path.join(dir, 'common/vendor.js');
  if (!fs.existsSync(vendorPath)) {
    errors.push('缺少 common/vendor.js');
  } else {
    const vendor = fs.readFileSync(vendorPath, 'utf-8');
    const hasVersion =
      vendor.includes(`versionName = "${expected.versionName}"`) ||
      vendor.includes(`appVersion:"${expected.versionName}"`) ||
      vendor.includes(`"${expected.versionName}"`);
    if (!hasVersion) {
      errors.push(`vendor.js 未含版本 ${expected.versionName}（可能是旧构建）`);
    }
  }

  const mePath = path.join(dir, 'pages/Me.js');
  if (!fs.existsSync(mePath)) {
    errors.push('缺少 pages/Me.js');
  } else {
    const me = fs.readFileSync(mePath, 'utf-8');
    if (!me.includes('handleNavigate("about")') && !me.includes('$("about")')) {
      errors.push('Me.js 未含「关于」入口');
    }
    if (!me.includes('APP_VERSION_NAME')) {
      errors.push('Me.js 未引用 APP_VERSION_NAME');
    }
  }

  const privacyPath = path.join(dir, 'components/MpPrivacyGateModal.js');
  if (!fs.existsSync(privacyPath)) {
    errors.push('缺少 components/MpPrivacyGateModal.js');
  }

  const scorecardPath = path.join(dir, 'pages/scorecard/scorecard.js');
  if (!fs.existsSync(scorecardPath)) {
    errors.push('缺少 pages/scorecard/scorecard.js');
  } else {
    const scorecard = fs.readFileSync(scorecardPath, 'utf-8');
    if (!scorecard.includes('gatePrivacyBeforeCloud')) {
      errors.push('scorecard.js 未含 gatePrivacyBeforeCloud');
    }
  }

  if (errors.length === 0) {
    console.log(`✓ ${label}：版本 ${expected.versionName}，关于页与隐私弹窗均已编译`);
  } else {
    console.error(`✗ ${label}：`);
    for (const e of errors) console.error(`  - ${e}`);
  }
  return errors;
}

const expected = readManifestVersion();
let allErrors = [];

for (const t of targets) {
  allErrors = allErrors.concat(checkDir(t.label, t.dir, expected));
}

if (allErrors.length > 0) {
  console.error('');
  console.error('请先执行 npm run build:mp-weixin，并在微信开发者工具中打开 dist/build/mp-weixin 上传。');
  console.error('若用开发模式：npm run dev:mp-weixin 后从仓库根目录（miniprogramRoot=dist/dev/mp-weixin）上传。');
  process.exit(1);
}

console.log('');
console.log('上传步骤：');
console.log('  1. 微信开发者工具 → 导入项目 → 选择 dist/build/mp-weixin（推荐）');
console.log('  2. 或导入仓库根目录（project.config.json 指向 dist/dev，需先 npm run dev:mp-weixin 并保持编译完成）');
console.log(`  3. 上传后在小程序「我的 → 关于」核对版本号为 ${expected.versionName}`);
