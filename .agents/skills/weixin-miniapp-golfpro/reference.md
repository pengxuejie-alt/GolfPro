# golfpro 微信小程序参考

## 云函数一览

| 云函数 | 职责 |
|--------|------|
| `login` | 换 openId、初始化 users |
| `getUserProfiles` | 批量 profile + 服务端 avatar 换链 |
| `resolveAvatarUrls` | 批量 cloud:// → https |
| `createMatch` | 创建比赛、写 roster |
| `joinMatch` | 加入比赛 |
| `leaveMatch` | 离开比赛 |
| `deleteMyMatch` | 删除比赛 |
| `getMatch` / `listMyMatches` | 读比赛 |
| `updateScore` | 更新成绩 |
| `updateUserProfile` | 更新用户资料 |
| `getMatchQr` | 分享二维码 |

## 头像数据流

```
users.avatarUrl (cloud://)
  → fetchUserProfilesForOpenIds
  → getUserProfiles 云函数 (https)
  → buildRosterAvatarDisplayMap / buildMatchListAvatarDisplayMap
  → matchAvatarDisplayMap / rosterAvatarDisplay
  → mpAvatarImgSrcForDisplay
  → <image>
```

Roster 回填：`mpMatchListRosterHydrate.ts` → `hydrateMatchListRostersFromUserProfiles`

## 玩家 ID 字段（历史债）

比赛 roster 可能含：`openid`、`openId`、`uid`、`id`、`player_uid`。  
**统一入口**：`resolvePlayerOpenId()` in `fetchUserProfilesForOpenIds.ts`。

## 版本与分支

- 功能分支示例：`cursor/uni-app-setup-541c5`
- 改用户可见行为时 bump `manifest.json` 的 `versionName` / `versionCode`

## 已知回归 commit（头像）

- `e01a52b` / `9faeeac`：禁止 cloud:// 直绑 + strip roster
- `93580fd`：修复 merge 丢弃 cloud://
- `2740e14`：统一 openId + getUserProfiles 云函数
- `0f74ced`：resolveAvatarUrls 云函数路径
- `4cdcdf1`：真机 cloud:// 展示兜底 (v1.2.18)
