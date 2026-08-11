---
name: weixin-miniapp-golfpro
description: golfpro 微信小程序（uni-app + 微信云开发）开发与调试指南。Use when working on WeChat mini program, uni-app MP-WEIXIN builds, cloud functions, avatars, match roster, scorecard, login, or when the user mentions 微信小程序、真机调试、云函数部署、头像不显示.
---

# golfpro 微信小程序开发

## 快速定位

| 领域 | 关键路径 |
|------|----------|
| 入口/首页 | `src/pages/index/index.vue` |
| 计分板 | `src/pages/scorecard/scorecard.vue` |
| 头像展示 | `src/utils/mpAvatarSrc.ts` → `rosterAvatarDisplay.ts` → `fetchUserProfilesForOpenIds.ts` |
| 云换链 | `cloudfunctions/getUserProfiles`、`cloudfunctions/resolveAvatarUrls` |
| 比赛 CRUD | `cloudfunctions/createMatch`、`joinMatch`；客户端 `src/utils/db.js` |
| 登录 | `cloudfunctions/login`；`src/store/userStore.ts` |
| 版本 | `src/manifest.json`（用户看 我的→关于） |

## 本地开发流程

```bash
npm run dev:mp-weixin
# 微信开发者工具打开 dist/dev/mp-weixin
```

- 怀疑 stale build：删 `dist/dev/mp-weixin` 后重建
- 真机调试：上传体验版或真机预览；模拟器与真机差异大时以真机为准
- vConsole：Log 搜 `[fetchUserProfiles]`、`[mpCloudFileUrl]`、`[mpMatchListRosterHydrate]`

## 云函数部署清单

改以下任一文件后，**必须**提醒用户部署（右键 → 上传并部署 → **云端安装依赖**）：

| 云函数 | 何时必部署 |
|--------|------------|
| `getUserProfiles` | 批量查 users/players 头像、服务端换链 |
| `resolveAvatarUrls` | roster 上残留 cloud:// 批量换 https |
| `createMatch` | roster 字段结构（id/openId/avatar） |
| `login` | 登录/openId 逻辑 |

云环境 ID 见 `src/utils/db.js`，须与开发者工具云开发环境一致。

## 头像问题排查

1. 确认小程序版本（manifest 与关于页）
2. 确认两个换链云函数已部署
3. vConsole 是否有云函数失败日志
4. 云库 `users` 对应 `_openid` 是否有 `avatarUrl`（cloud:// 或 https）
5. roster 上 `player.avatar` 是否被 strip；应用 `resolvePlayerOpenId` 查 profile

**架构要点**：https 优先；resolve 失败时 MP-WEIXIN 真机可直绑 `cloud://`（v1.2.18+ 兜底）。

## 改代码防回归清单

改头像/登录/比赛列表时，复制此清单：

```
- [ ] grep 引用点：index / scorecard / Me / matchStore
- [ ] openId 统一 resolvePlayerOpenId
- [ ] rosterAvatarForMerge 保留 cloud://
- [ ] 首页与计分板 hydration 同链路
- [ ] bump manifest 版本
- [ ] 列出需部署的云函数
- [ ] 说明验证：首页同组头像 + 计分板 + 冷启动
```

## 常见坑

| 现象 | 常见原因 |
|------|----------|
| 仅自己头像、队友全空 | 换链云函数未部署；或展示层 strip cloud:// |
| 进计分页才有头像 | 首页 hydrate 未走 batch / 登录前 hydrate |
| `$gwx is not defined` | stale dist；或 devtools base library 过高 |
| `queueMicrotask is not defined` | 旧基础库；已改用 Promise.then |
| createMatch not_found | 未登录或未等 db.init |

## 详细参考

- 文件与云函数对照表见 [reference.md](reference.md)
