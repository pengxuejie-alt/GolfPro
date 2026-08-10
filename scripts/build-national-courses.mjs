/**
 * 从 GolfLive 全量 JSON + 382 种子名单 生成 src/data/nationalCourses.ts
 *
 * 用法:
 *   node scripts/build-national-courses.mjs
 *   node scripts/build-national-courses.mjs --fetch-missing --openid=xxx
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'https://app1.golflive.cn/index.php?s=/Home/ApiGolflive/'

/** 应用内显示名（麓湖已校对，勿改 par） */
const DISPLAY_OVERRIDES = {
  '12500-BA0C-0331': {
    name: '广州麓湖高尔夫',
    holes_par: [5, 4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 5, 4],
    total_par: 72,
  },
  '12400-363F-474D': {
    name: '广州仙村国际高尔夫',
  },
}

const PROVINCE_NORM = {
  广西省: '广西',
  广西: '广西',
  宁夏省: '宁夏',
  宁夏: '宁夏',
  新疆省: '新疆',
  新疆: '新疆',
  内蒙古: '内蒙古',
  黑龙江: '黑龙江省',
  北京: '北京市',
  北京市: '北京市',
  上海: '上海市',
  上海市: '上海市',
  天津: '天津市',
  天津市: '天津市',
  重庆: '重庆市',
  重庆市: '重庆市',
  海南: '海南省',
  海南省: '海南省',
  浙江: '浙江省',
  浙江省: '浙江省',
  山东: '山东省',
  山东省: '山东省',
  四川: '四川省',
  四川省: '四川省',
  云南: '云南省',
  云南省: '云南省',
  湖南: '湖南省',
  湖南省: '湖南省',
  河北: '河北省',
  河北省: '河北省',
}

function normalizeProvince(p) {
  const s = String(p || '').trim()
  if (!s) return '其他'
  if (PROVINCE_NORM[s]) return PROVINCE_NORM[s]
  if (s.endsWith('省')) return s
  if (/^(北京|上海|天津|重庆)/.test(s)) return `${s}市`
  return s.endsWith('市') ? s : s
}

function normalizeNameKey(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/(省|市|区|县|自治区|高尔夫|国际|俱乐部|球会|球场|乡村|度假|温泉|体育|公园|练习场|果岭)/g, '')
    .toLowerCase()
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function post(endpoint, data, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
    })
    const json = await res.json()
    const msg = String(json.msg || '')
    if (msg.includes('频繁') || msg.includes('稍后再')) {
      await sleep(3000 * (attempt + 1))
      continue
    }
    return json
  }
  throw new Error(`${endpoint} 多次限流失败`)
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
    province: normalizeProvince(club.state ?? club.province ?? ''),
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

function applyOverrides(course) {
  const ov = DISPLAY_OVERRIDES[course.golflive_club_id]
  if (!ov) return course
  return {
    ...course,
    ...ov,
    total_par: ov.total_par ?? course.total_par,
    holes_par: ov.holes_par ?? course.holes_par,
  }
}

function matchSeedToCourse(seedName, courses) {
  const key = normalizeNameKey(seedName)
  if (key.length < 2) return null
  let best = null
  let bestLen = 0
  for (const c of courses) {
    const ck = normalizeNameKey(c.name)
    if (!ck) continue
    if (ck === key || ck.includes(key) || key.includes(ck)) {
      const len = Math.min(ck.length, key.length)
      if (len > bestLen) {
        bestLen = len
        best = c
      }
    }
  }
  return best
}

function courseToTsObject(c) {
  const lines = ['    {']
  lines.push(`      id: ${JSON.stringify(c.golflive_club_id)},`)
  lines.push(`      name: ${JSON.stringify(c.name)},`)
  lines.push(`      city: ${JSON.stringify(c.city || '')},`)
  lines.push(`      total_par: ${c.total_par ?? 72},`)
  if (c.holes_par?.length) {
    lines.push(`      holes_par: [${c.holes_par.join(', ')}],`)
  }
  if (c.sections?.length) {
    lines.push('      sections: [')
    for (const s of c.sections) {
      lines.push(`        { name: ${JSON.stringify(s.name)}, holes_par: [${s.holes_par.join(', ')}] },`)
    }
    lines.push('      ],')
  }
  lines.push('    }')
  return lines.join('\n')
}

function parseArgs(argv) {
  const opts = { fetchMissing: false, openid: process.env.GOLFLIVE_OPENID || '', delay: 600 }
  for (const arg of argv) {
    if (arg === '--fetch-missing') opts.fetchMissing = true
    else if (arg.startsWith('--openid=')) opts.openid = arg.slice(9).trim()
    else if (arg.startsWith('--delay=')) opts.delay = Math.max(300, Number(arg.slice(8)) || 600)
  }
  return opts
}

async function fetchMissingFromGolflive(openid, seeds, existingCourses, delay) {
  const byId = new Map(existingCourses.map((c) => [c.golflive_club_id, c]))
  const matchedIds = new Set(existingCourses.map((c) => c.golflive_club_id))
  const unmatched = seeds.filter((s) => !matchSeedToCourse(s, existingCourses))
  console.log(`\n[补拉] 382 名单中 ${unmatched.length} 条未模糊匹配 GolfLive，尝试关键词搜索…`)

  let added = 0
  for (let i = 0; i < unmatched.length; i++) {
    const seed = unmatched[i]
    const kw = seed.replace(/.*?(区|县|市)/, '').replace(/(高尔夫|俱乐部|球会).*/, '').trim().slice(0, 6)
    if (kw.length < 2) continue
    process.stdout.write(`  [${i + 1}/${unmatched.length}] 「${kw}」(${seed.slice(0, 20)}…) … `)
    try {
      const r = await post('getClubList', {
        openid,
        req_type: 2,
        latitude: 23.12,
        longitude: 113.36,
        req_str: kw,
        map_ok: 0,
        simple_wea: 1,
      })
      if (String(r.ret_code) !== '1') {
        console.log(`skip (${r.msg || r.ret_code})`)
        await sleep(delay)
        continue
      }
      const list = Array.isArray(r.data) ? r.data : []
      let hit = false
      for (const raw of list) {
        const clubId = String(raw.club_id ?? raw.id ?? '')
        if (!clubId || matchedIds.has(clubId)) continue
        const detailR = await post('club_get', { openid, club_id: clubId })
        if (String(detailR.ret_code) !== '1') continue
        const course = applyOverrides(halvesToCourse(detailR.data))
        if (!course.holes_par?.length && !course.sections?.length) continue
        byId.set(clubId, course)
        matchedIds.add(clubId)
        added++
        hit = true
        console.log(`+ ${course.name}`)
        await sleep(delay)
        break
      }
      if (!hit) console.log('无新结果')
    } catch (e) {
      console.log(`ERR ${e.message}`)
    }
    await sleep(delay)
  }
  console.log(`[补拉] 新增 ${added} 个球场`)
  return [...byId.values()]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const golflivePath = path.join(__dirname, 'output/golflive-courses-full.json')
  if (!fs.existsSync(golflivePath)) {
    console.error(`缺少 ${golflivePath}，请先运行 fetch-golflive-courses.mjs --full`)
    process.exit(1)
  }

  const golflive = JSON.parse(fs.readFileSync(golflivePath, 'utf8'))
  let courses = (golflive.courses || []).map((c) =>
    applyOverrides({
      ...c,
      province: normalizeProvince(c.province),
      golflive_club_id: c.golflive_club_id || c.club_id,
    }),
  )

  const byId = new Map()
  for (const c of courses) {
    if (!c.golflive_club_id) continue
    if (!byId.has(c.golflive_club_id)) byId.set(c.golflive_club_id, c)
  }
  courses = [...byId.values()]

  const seedPath = path.join(__dirname, 'data/china-golf-seed-382.json')
  let seeds = []
  if (fs.existsSync(seedPath)) {
    seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8')).entries || []
  }

  if (opts.fetchMissing) {
    if (!opts.openid) {
      console.error('--fetch-missing 需要 --openid=xxx')
      process.exit(1)
    }
    courses = await fetchMissingFromGolflive(opts.openid, seeds, courses, opts.delay)
  }

  const seedReport = seeds.map((name) => {
    const m = matchSeedToCourse(name, courses)
    return { seed: name, matched: !!m, golflive_name: m?.name, club_id: m?.golflive_club_id }
  })
  const matchedCount = seedReport.filter((r) => r.matched).length

  const byProvince = {}
  for (const c of courses) {
    const p = c.province || '其他'
    if (!byProvince[p]) byProvince[p] = []
    byProvince[p].push(c)
  }
  for (const p of Object.keys(byProvince)) {
    byProvince[p].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  const provKeys = Object.keys(byProvince).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const tsParts = [
    '/**',
    ' * 全国高尔夫球场（Par 以 GolfLive club_get 为准）',
    ` * 生成: ${new Date().toISOString()}`,
    ` * 球场数: ${courses.length}；382 种子匹配: ${matchedCount}/${seeds.length}`,
    ' */',
    'export type NationalCourse = {',
    '  id: string;',
    '  name: string;',
    '  city: string;',
    '  total_par: number;',
    '  holes_par?: number[];',
    '  sections?: { name: string; holes_par: number[] }[];',
    '};',
    '',
    'export const nationalCourseData: Record<string, NationalCourse[]> = {',
  ]
  for (const p of provKeys) {
    tsParts.push(`  ${JSON.stringify(p)}: [`)
    for (const c of byProvince[p]) {
      tsParts.push(`${courseToTsObject(c)},`)
    }
    tsParts.push('  ],')
  }
  tsParts.push('};', '')

  const outTs = path.join(__dirname, '../src/data/nationalCourses.ts')
  fs.writeFileSync(outTs, tsParts.join('\n'), 'utf8')

  const report = {
    built_at: new Date().toISOString(),
    golflive_source: golflivePath,
    total_courses: courses.length,
    provinces: provKeys.length,
    with_holes_par: courses.filter((c) => c.holes_par?.length === 18).length,
    with_sections: courses.filter((c) => c.sections?.length).length,
    seed_382: { total: seeds.length, matched: matchedCount, unmatched: seeds.length - matchedCount },
    overrides: Object.keys(DISPLAY_OVERRIDES),
    seed_unmatched: seedReport.filter((r) => !r.matched).map((r) => r.seed),
  }
  const reportPath = path.join(__dirname, 'output/national-courses-report.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(`\n生成 ${courses.length} 球场 / ${provKeys.length} 省 → ${outTs}`)
  console.log(`382 种子匹配 ${matchedCount}/${seeds.length}`)
  console.log(`报告 → ${reportPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
