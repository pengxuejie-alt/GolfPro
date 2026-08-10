/**
 * 从 GolfLive API 批量拉取全国球场列表 + 各洞标准杆。
 *
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --list-only
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --details-only
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --details-only --resume
 *
 * 可选：--province=广东  --delay=400  --list-delay=1500  --out=路径
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://app1.golflive.cn/index.php?s=/Home/ApiGolflive/'

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
    detailsOnly: false,
    resume: false,
    province: '',
    delay: 400,
    listDelay: 1500,
    out: path.join(__dirname, 'output', 'golflive-courses.json'),
  }
  for (const arg of argv) {
    if (arg === '--list-only') opts.listOnly = true
    else if (arg === '--details-only') opts.detailsOnly = true
    else if (arg === '--resume') opts.resume = true
    else if (arg.startsWith('--openid=')) opts.openid = arg.slice(9).trim()
    else if (arg.startsWith('--province=')) opts.province = arg.slice(11).trim().replace(/省$/, '')
    else if (arg.startsWith('--delay=')) opts.delay = Math.max(200, Number(arg.slice(8)) || 400)
    else if (arg.startsWith('--list-delay=')) opts.listDelay = Math.max(500, Number(arg.slice(13)) || 1500)
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6))
  }
  return opts
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function post(endpoint, data, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const body = new URLSearchParams(data)
    const res = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`${endpoint} 非 JSON: ${text.slice(0, 200)}`)
    }
    const msg = String(json.msg || '')
    if (msg.includes('频繁') || msg.includes('稍后再')) {
      const wait = 3000 * (attempt + 1)
      console.warn(`  限流，${wait / 1000}s 后重试 (${attempt + 1}/${retries})…`)
      await sleep(wait)
      continue
    }
    return json
  }
  throw new Error(`${endpoint} 多次限流失败`)
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

function loadExisting(outPath) {
  if (!fs.existsSync(outPath)) return null
  try {
    return JSON.parse(fs.readFileSync(outPath, 'utf8'))
  } catch {
    return null
  }
}

function saveResult(outPath, result) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
}

async function fetchAllLists(openid, provinces, listDelay) {
  const byId = new Map()
  for (const p of provinces) {
    try {
      const list = await fetchClubList(openid, p)
      for (const raw of list) {
        const item = clubListItem(raw)
        if (!item.club_id) continue
        if (!byId.has(item.club_id)) byId.set(item.club_id, item)
      }
      console.log(`  ${p}: ${list.length} 条，累计去重 ${byId.size}`)
    } catch (e) {
      console.warn(`  ${p}: 失败 — ${e.message}`)
    }
    await sleep(listDelay)
  }
  return [...byId.values()]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.openid) {
    console.error('缺少 openid：--openid=xxx 或环境变量 GOLFLIVE_OPENID')
    process.exit(1)
  }

  const provinces = opts.province ? [opts.province] : PROVINCES
  const existing = opts.resume ? loadExisting(opts.out) : null
  const doneIds = new Set((existing?.courses || []).map((c) => c.golflive_club_id))

  let clubs = existing?.clubs || []
  let courses = existing?.courses ? [...existing.courses] : []

  if (!opts.detailsOnly) {
    console.log(`[1/2] 拉取 ${provinces.length} 个省的球场列表（间隔 ${opts.listDelay}ms）…`)
    clubs = await fetchAllLists(opts.openid, provinces, opts.listDelay)
    const partial = {
      fetched_at: new Date().toISOString(),
      source: 'golflive ApiGolflive',
      province_count: provinces.length,
      club_count: clubs.length,
      clubs,
      courses,
    }
    saveResult(opts.out, partial)
    console.log(`\n列表已保存：${clubs.length} 个球场 → ${opts.out}`)
    if (opts.listOnly) return
  } else if (!clubs.length) {
    const ex = loadExisting(opts.out)
    if (!ex?.clubs?.length) {
      console.error('--details-only 需要已有 clubs 列表，请先 --list-only')
      process.exit(1)
    }
    clubs = ex.clubs
    courses = ex.courses || []
    for (const c of courses) doneIds.add(c.golflive_club_id)
  }

  const pending = clubs.filter((c) => !doneIds.has(c.club_id))
  console.log(`\n[2/2] club_get：共 ${clubs.length}，已完成 ${doneIds.size}，待拉 ${pending.length}（间隔 ${opts.delay}ms）…`)

  const result = {
    fetched_at: new Date().toISOString(),
    source: 'golflive ApiGolflive',
    province_count: provinces.length,
    club_count: clubs.length,
    clubs,
    courses,
  }

  let ok = 0
  let fail = 0
  for (let i = 0; i < pending.length; i++) {
    const { club_id, club_name } = pending[i]
    process.stdout.write(`  [${doneIds.size + 1}/${clubs.length}] ${club_name || club_id} … `)
    try {
      const detail = await fetchClubDetail(opts.openid, club_id)
      courses.push(halvesToCourse(detail))
      doneIds.add(club_id)
      ok++
      console.log('OK')
    } catch (e) {
      fail++
      console.log(`FAIL (${e.message})`)
    }
    result.courses = courses
    result.fetched_at = new Date().toISOString()
    if ((i + 1) % 10 === 0 || i === pending.length - 1) saveResult(opts.out, result)
    if (i < pending.length - 1) await sleep(opts.delay)
  }

  saveResult(opts.out, result)
  console.log(`\n完成。详情成功 +${ok}，失败 ${fail}，合计 ${courses.length}/${clubs.length}`)
  console.log(`→ ${opts.out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
