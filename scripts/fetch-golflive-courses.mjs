/**
 * 从 GolfLive API 批量拉取全国球场 + 标准杆
 *
 * GolfLive getClubList 语义（SelectCourse 源码）：
 *   req_type=1  附近球场（GPS）
 *   req_type=2  关键词搜索（如「麓湖」）
 *   req_type=3  按省/区域（如「广东省」）
 *
 * 用法：
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --list-only
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --full
 *   node scripts/fetch-golflive-courses.mjs --openid=xxx --details-only --resume
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://app1.golflive.cn/index.php?s=/Home/ApiGolflive/'

/** SelectCourse.provice 数组（含「省」） */
const PROVINCES = [
  '江苏省', '浙江省', '福建省', '河北省', '山西省', '辽宁省', '吉林省', '黑龙江',
  '安徽省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '海南省',
  '四川省', '贵州省', '云南省', '陕西省', '甘肃省', '青海省', '内蒙古', '广西',
  '宁夏', '新疆', '西藏',
]

const CITY_SEARCH = [
  '北京', '上海', '天津', '重庆', '广州', '深圳', '东莞', '佛山', '惠州', '清远',
  '中山', '江门', '珠海', '汕头', '梅州', '海口', '三亚', '琼海', '万宁', '儋州',
  '南京', '苏州', '杭州', '宁波', '青岛', '济南', '烟台', '威海', '大连', '沈阳',
  '成都', '昆明', '西安', '武汉', '长沙', '郑州', '石家庄', '秦皇岛', '廊坊',
  '观澜湖', '麓湖', '风神', '九龙湖', '南沙', '沙河', '西丽', '隐秀', '博鳌',
  '佘山', '美兰湖', '汤臣', '旭宝', '天马', '观澜', '团泊', '盘山', '华彬', '万柳',
]

function parseArgs(argv) {
  const opts = {
    openid: process.env.GOLFLIVE_OPENID || '',
    listOnly: false,
    detailsOnly: false,
    full: false,
    resume: false,
    province: '',
    delay: 450,
    listDelay: 1200,
    searchDelay: 800,
    out: path.join(__dirname, 'output', 'golflive-courses.json'),
  }
  for (const arg of argv) {
    if (arg === '--list-only') opts.listOnly = true
    else if (arg === '--details-only') opts.detailsOnly = true
    else if (arg === '--full') opts.full = true
    else if (arg === '--resume') opts.resume = true
    else if (arg.startsWith('--openid=')) opts.openid = arg.slice(9).trim()
    else if (arg.startsWith('--province=')) opts.province = arg.slice(11).trim()
    else if (arg.startsWith('--delay=')) opts.delay = Math.max(200, Number(arg.slice(8)) || 450)
    else if (arg.startsWith('--list-delay=')) opts.listDelay = Math.max(500, Number(arg.slice(13)) || 1200)
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice(6))
  }
  if (opts.full) {
    /* --full 与 --list-only 同时出现时，以 list-only 为准 */
    if (!argv.includes('--list-only')) opts.listOnly = false
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
      await sleep(3000 * (attempt + 1))
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
    latitude: c.latitude ?? c.lat,
    longitude: c.longitude ?? c.lng,
    club_holes: c.club_holes,
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

async function getClubList(openid, reqType, reqStr, lat = 23.12, lng = 113.36) {
  const r = await post('getClubList', {
    openid,
    req_type: reqType,
    latitude: lat,
    longitude: lng,
    req_str: reqStr,
    map_ok: 0,
    simple_wea: 1,
  })
  if (String(r.ret_code) !== '1') {
    throw new Error(`getClubList(${reqType},${reqStr}): ${r.msg || r.ret_code}`)
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

function loadSearchKeywords() {
  const kwPath = path.join(__dirname, 'data', 'golflive-search-keywords.json')
  let extra = []
  if (fs.existsSync(kwPath)) {
    try {
      extra = JSON.parse(fs.readFileSync(kwPath, 'utf8')).keywords || []
    } catch { /* ignore */ }
  }
  const all = [...CITY_SEARCH, ...extra]
  return [...new Set(all.map((s) => String(s).trim()).filter((s) => s.length >= 2))]
}

async function collectAllClubs(openid, opts) {
  const byId = new Map()
  const add = (list, source) => {
    for (const raw of list) {
      const item = clubListItem(raw)
      if (!item.club_id) continue
      if (!byId.has(item.club_id)) byId.set(item.club_id, { ...item, source })
    }
  }

  const provinces = opts.province ? [opts.province] : PROVINCES
  console.log(`[列表] 按省 req_type=3（${provinces.length} 个）…`)
  for (const p of provinces) {
    try {
      const list = await getClubList(openid, 3, p)
      add(list, `province:${p}`)
      console.log(`  ${p}: ${list.length} 条，累计 ${byId.size}`)
    } catch (e) {
      console.warn(`  ${p}: ${e.message}`)
    }
    await sleep(opts.listDelay)
  }

  if (opts.full || opts.province) {
    const keywords = opts.province
      ? [opts.province.replace(/省$/, ''), ...CITY_SEARCH]
      : loadSearchKeywords()
    console.log(`\n[列表] 关键词搜索 req_type=2（${keywords.length} 个）…`)
    for (const kw of keywords) {
      try {
        const list = await getClubList(openid, 2, kw)
        const before = byId.size
        add(list, `search:${kw}`)
        if (byId.size > before) {
          console.log(`  「${kw}」+${byId.size - before} → 累计 ${byId.size}`)
        }
      } catch (e) {
        console.warn(`  「${kw}」: ${e.message}`)
      }
      await sleep(opts.searchDelay)
    }
  }

  return [...byId.values()]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.full && !opts.listOnly && !opts.detailsOnly && !opts.province) {
    opts.full = true
  }
  if (!opts.openid) {
    console.error('缺少 --openid=xxx')
    process.exit(1)
  }

  const existing = opts.resume || opts.detailsOnly ? loadExisting(opts.out) : null
  const doneIds = new Set((existing?.courses || []).map((c) => c.golflive_club_id))
  let courses = existing?.courses ? [...existing.courses] : []

  let clubs = existing?.clubs || []
  if (!opts.detailsOnly) {
    clubs = await collectAllClubs(opts.openid, opts)
    saveResult(opts.out, {
      fetched_at: new Date().toISOString(),
      source: 'golflive ApiGolflive',
      club_count: clubs.length,
      clubs,
      courses,
    })
    console.log(`\n列表合计 ${clubs.length} 个球场 → ${opts.out}`)
    if (opts.listOnly) return
  } else if (!clubs.length) {
    console.error('--details-only 需要已有 clubs')
    process.exit(1)
  }

  const pending = clubs.filter((c) => !doneIds.has(c.club_id))
  console.log(`\n[详情] club_get：${clubs.length} 总数，已有 ${doneIds.size}，待拉 ${pending.length}`)

  const result = {
    fetched_at: new Date().toISOString(),
    source: 'golflive ApiGolflive',
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
      courses.push(halvesToCourse(await fetchClubDetail(opts.openid, club_id)))
      doneIds.add(club_id)
      ok++
      console.log('OK')
    } catch (e) {
      fail++
      console.log(`FAIL (${e.message})`)
    }
    result.courses = courses
    if ((i + 1) % 10 === 0) saveResult(opts.out, result)
    if (i < pending.length - 1) await sleep(opts.delay)
  }

  saveResult(opts.out, result)
  console.log(`\n完成。详情 +${ok} 失败 ${fail}，合计 ${courses.length}/${clubs.length}`)
  console.log(`→ ${opts.out}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
