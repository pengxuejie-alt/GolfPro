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

## 5. 报告模板

Automation 结束时应输出：

```markdown
## GolfPro 回归报告
- check:miniapp-regression: PASS/FAIL
- lint: PASS/FAIL/SKIP
- auto-fix: 无 / 已 sync cloud common
- 需手动部署云函数: getMatch, listMyMatches, joinMatch, …
- manifest 版本: x.y.z
```
