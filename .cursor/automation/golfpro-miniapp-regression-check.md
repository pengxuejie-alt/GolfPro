# GolfPro 小程序回归检查（Automation 指令）

供 Cursor Automation 在 **git push** 或手动运行时引用。云函数**上传**仍需在微信开发者工具手动完成。

## 1. 运行检查

```bash
npm run check:miniapp-regression
```

若失败且与云函数 common 同步有关：

```bash
npm run check:miniapp-regression -- --fix
npm run check:miniapp-regression
```

可选类型检查：

```bash
npm run lint
```

## 2. 可安全自动修复

| 问题 | 动作 |
|------|------|
| 缺少 `cloudfunctions/*/rosterAvatarEnrich.js` | `node scripts/sync-cloud-matchCanonical.mjs`（`--fix` 已包含） |
| `require('../common/...')` 在已部署云函数里 | 改为 `./rosterAvatarEnrich` 并同步文件 |

修复后：**只 commit 回归相关文件**，中文 commit message 说明 why，然后 push。

## 3. 不可自动修复（必须在报告中列出）

- 微信开发者工具 → 云函数 **上传并部署**（`getMatch`、`listMyMatches`、`joinMatch`、`getUserProfiles`）
- 云开发环境 ID 与 `src/utils/db.js` 一致
- 真机 / 模拟器头像、FlClash 代理规则
- 用户隐私授权弹窗、OpenID 登录态

## 4. 头像 / 计分防回归清单

改以下路径时必须过本检查 + 人工验证：

- `src/pages/index/index.vue` — `handleOpenScorecard` + `stashScorecardPrefillFromIndex`
- `src/pages/scorecard/scorecard.vue` — `sessionPrefillAvatars`、`ensureRosterAvatarsStable`、`localRosterIdsSig`
- `src/utils/fetchUserProfilesForOpenIds.ts` — 勿误报「仍无可用头像」
- `src/utils/scorecardPrefill.ts`、`src/utils/rosterPlayerNormalize.ts`
- `cloudfunctions/common/rosterAvatarEnrich.js` 及三个消费函数目录

**人工验证**：首页同组 3 人头像 → 点进计分页 **首次**即 3 人 3 头像，无 1–2 秒闪空白。

## 5. 表单 input 布局防回归

改 `src/app-mp.css` 或带 `input` 的页面时，检查脚本会验证：

| 反模式 | 后果 | 正确做法 |
|--------|------|----------|
| `mp-safe-input-*` 的 `min-height` < `line-height` + 上下 padding | 占位符/文字上下被裁切 | 保持 `app-mp.css` 中 flex=80rpx、inline=64rpx、full=112rpx |
| 前缀图标 + input 仅依赖 `gap` | 微信 input 常忽略 flex gap，文字压住图标 | 用 `.mp-input-prefix-row` 或绝对定位图标 + input `pl-12` |
| `mp-safe-input-*` 叠 `py-0` / `py-1` | 破坏竖直安全区内边距 | 只用 mp-safe-input 自带 padding |
| 表单行无 `items-center` | 标签与 input 纵向不齐 | 行容器 `flex items-center` |

**涉及页面**：`CreateMatch.vue`（比赛名称）、`scorecard.vue`（添加球手）、`SelectPlayer.vue`、`Players.vue`、`CreateMatchCoursePicker.vue`。

**人工验证**：发布球局 → 比赛名称行文字垂直居中无裁切；计分页 → 添加球手 → placeholder 不与左侧图标重叠。

## 6. 报告模板

Automation 结束时应输出：

```markdown
## GolfPro 回归报告
- check:miniapp-regression: PASS/FAIL
- lint: PASS/FAIL/SKIP
- auto-fix: 无 / 已 sync cloud common
- UI layout: mp-safe-input 高度 / mp-input-prefix-row（见脚本输出）
- 需手动部署云函数: getMatch, listMyMatches, joinMatch, …
- manifest 版本: x.y.z
```
