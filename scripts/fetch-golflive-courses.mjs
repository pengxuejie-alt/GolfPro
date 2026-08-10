/**
 * 从 GolfLive 公开 API 批量拉取全国球场列表 + 各洞标准杆。
 *
 * 只需抓包一次拿到 openid（任意 getClubList / club_get 请求里都有）：
 *   node scripts/fetch-golflive-courses.mjs --openid=oXXXXXXXX
 * 或：
 *   set GOLFLIVE_OPENID=oXXXXXXXX   (PowerShell: $env:GOLFLIVE_OPENID="...")
 *
 * 可选：
 *   --list-only        只拉各省列表，不请求 club_get（快）
 *   --province=广东  只拉单个省（不要加「省」字，与 API 一致）
 *   --delay=300        每个 club_get 间隔毫秒（默认 350）
 *   --out=路径         输出 JSON（默认 scripts/output/golflive-courses.json）
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://app1.golflive.cn/index.php?s=/Home/ApiGolflive/'

/** 与 GolfLive SelectCourse 页 provice 数组一致；API req_str 需去掉「省」后缀 */
const PROVINCES = [
  '江苏', '浙江', '福建', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '安徽', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南',
  '四川', '贵州', '云南', '陕西', '甘肃', '青海', '内蒙古', '广西',
  '宁夏', '新疆', '西藏',
]

function parseArgs(argv) {
  const opts = {
    openid: process.env.GOLFLIVE_OPENID || '',
    listOnly: false,
    province: '',
    delay: 350,
    out: path.join(__dirname, 'output', 'golflive-courses.json'),
  }
  for (const arg of argv) {
    if (arg === '--list-only') opts.listOnly = true
    else if (arg.startsWith('--openid=')) opts.openid = arg.slice(9).trim()
    else if (arg.startsWith('--province=')) opts.province = arg.slice(11).trim().replace(/省$/, '')
    else if (arg.startsWith('--delay=')) opts.delay = Math.max(100, Number(arg.slice(8)) || 350)
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6))
  }
  return opts
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function post(endpoint, data) {
  const body = new URLSearchParams(data)
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${endpoint} 非 JSON: ${text.slice(0, 200)}`)
  }
}

function clubListItem(c) {
  return {
    club_id: String(c.club_id ?? c.id ?? ''),
    club_name: c.club_name ?? c.name ?? '',
    city: c.city ?? c.club_city ?? '',
    state: c.state ?? c.province ?? '',
    latitude: c.latitude,
    longitude: c.longitude,
  }
}

function halvesToCourse(detail) {
  const club = detail?.club ?? {}
  const halves = detail?.half ?? detail?.half_arr ?? []
  const sections = halves.map((h) => {
    const holes = []
    for (let i = 1; i <= 9; i++) {
      const v = h[`hole${i}`]
      if (v != null && v !== '') holes.push(Number(v))
    }
    return { name: h.half_name || h.name || '半场', holes_par: holes }
  })
  const holes_par = sections.flatMap((s) => s.holes_par)
  const total_par = holes_par.reduce((a, b) => a + b, 0)

  const out = {
    golflive_club_id: String(club.club_id ?? ''),
    name: club.club_name ?? '',
    city: club.city ?? '',
    province: club.state ?? club.province ?? '',
    total_par: total_par || undefined,
  }
  if (sections.length === 1 && sections[0].holes_par.length === 18) {
    out.holes_par = sections[0].holes_par
  } else if (sections.length === 2 && holes_par.length === 18) {
    out.holes_par = holes_par
    out.sections = sections
  } else if (sections.length >= 2) {
    out.sections = sections
    if (holes_par.length) out.holes_par = holes_par
  } else if (holes_par.length) {
    out.holes_par = holes_par
  }
  return out
}

async function fetchClubList(openid, province) {
  const r = await post('getClubList', {
    openid,
    req_type: 2,
    latitude: 23.13,
    longitude: 113.26,
    req_str: province,
    map_ok: 0,
    simple_wea: 1,
  })
  if (String(r.ret_code) !== '1') {
    throw new Error(`getClubList(${province}): ${r.msg || r.ret_code}`)
  }
  return Array.isArray(r.data) ? r.data : []
}

async function fetchClubDetail(openid, clubId) {
  const r = await post('club_get', { openid, club_id: clubId })
  if (String(r.ret_code) !== '1') {
    throw new Error(`club_get(${clubId}): ${r.msg || r.ret_code}`)
  }
  return r.data
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.openid) {
    console.error(`
缺少 openid。只需从抓包里复制一次（任意 GolfLive 请求的 openid= 字段）：

  node scripts/fetch-golflive-courses.mjs --openid=你的openid

或设置环境变量 GOLFLIVE_OPENID。
`)
    process.exit(1)
  }

  const provinces = opts.province ? [opts.province] : PROVINCES
  const byId = new Map()

  console.log(`[1/2] 拉取 ${provinces.length} 个省的球场列表…`)
  for (const p of provinces) {
    try {
      const list = await fetchClubList(opts.openid, p)
      for (const raw of list) {
        const item = clubListItem(raw)
        if (!item.club_id) continue
        if (!byId.has(item.club_id)) {
          byId.set(item.club_id, { ...item, provinces_seen: [p] })
        } else {
          const ex = byId.get(item.club_id)
          if (!ex.provinces_seen.includes(p)) ex.provinces_seen.push(p)
        }
      }
      console.log(`  ${p}: ${list.length} 条，累计去重 ${byId.size}`)
      await sleep(200)
    } catch (e) {
      console.warn(`  ${p}: 失败 — ${e.message}`)
    }
  }

  const list = [...byId.values()]
  const result = {
    fetched_at: new Date().toISOString(),
    source: 'golflive ApiGolflive',
    province_count: provinces.length,
    club_count: list.length,
    clubs: list.map(({ provinces_seen, ...rest }) => rest),
    courses: [],
  }

  if (opts.listOnly) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true })
    fs.writeFileSync(opts.out, JSON.stringify(result, null, 2), 'utf8')
    console.log(`\n完成（仅列表）。共 ${list.length} 个球场 → ${opts.out}`)
    return
  }

  console.log(`\n[2/2] 拉取各球场标准杆 club_get（共 ${list.length} 个，间隔 ${opts.delay}ms）…`)
  let ok = 0
  let fail = 0
  for (let i = 0; i < list.length; i++) {
    const { club_id, club_name } = list[i]
    process.stdout.write(`  [${i + 1}/${list.length}] ${club_name || club_id} … `)
    try {
      const detail = await fetchClubDetail(opts.openid, club_id)
      result.courses.push(halvesToCourse(detail))
      ok++
      console.log('OK')
    } catch (e) {
      fail++
      console.log(`FAIL (${e.message})`)
    }
    if (i < list.length - 1) await sleep(opts.delay)
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true })
  fs.writeFileSync(opts.out, JSON.stringify(result, null, 2), 'utf8')
  console.log(`\n完成。列表 ${list.length}，详情成功 ${ok}，失败 ${fail}`)
  console.log(`→ ${opts.out}`)
  console.log('\n确认数据无误后，可把 courses 合并进 src/data/（需要再说一声我帮你写导入脚本）。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
