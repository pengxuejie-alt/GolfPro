/**
 * 按已有球场编号重拉 GolfLive 每洞标准杆，写回 src/data/nationalCourses.ts。
 * 详情接口不用 openid。已核对的三家以 scripts/data/par-verified-lock.json 为准。
 *
 * 用法:
 *   node scripts/refresh-course-pars.mjs
 *   node scripts/refresh-course-pars.mjs --apply-only
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { nationalCourseData } from '../src/data/nationalCourses.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'output/golflive-par-refresh.json')
const LOCK_PATH = path.join(__dirname, 'data/par-verified-lock.json')
const TS_PATH = path.join(__dirname, '../src/data/nationalCourses.ts')
const DETAIL = 'https://app.golflive.cn/index.php?s=/Home/ApiGolflive5/club_get'
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002a2f) NetType/WIFI Language/zh_CN',
  Referer: 'https://servicewechat.com/wx6c03ed6dfa30c735/595/page-frame.html',
  'Content-Type': 'application/x-www-form-urlencoded',
}

const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')).courses || {}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function samePars(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n, i) => n === b[i])
}

function flatSections(sections) {
  return (sections || []).flatMap((s) => s.holes_par || [])
}

function liveSections(detail) {
  const halves = [...(detail?.half || detail?.half_arr || [])].sort(
    (a, b) => Number(a.pos ?? 0) - Number(b.pos ?? 0),
  )
  const sections = []
  for (const h of halves) {
    const holes = []
    for (let i = 1; i <= 9; i++) {
      const v = h[`hole${i}`]
      if (v == null || v === '') break
      holes.push(Number(v))
    }
    if (holes.length !== 9 || holes.some((n) => ![3, 4, 5, 6].includes(n))) return null
    const name = String(h.half_name || '').trim() || String(h.half_id || '').trim() || '半场'
    sections.push({ name, holes_par: holes })
  }
  if (sections.length < 2) return null
  return sections
}

async function fetchDetail(clubId) {
  for (let attempt = 0; attempt <= 5; attempt++) {
    const res = await fetch(DETAIL, {
      method: 'POST',
      headers: HEADERS,
      body: new URLSearchParams({ club_id: clubId }),
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`非 JSON: ${text.slice(0, 120)}`)
    }
    const msg = String(json.msg || '')
    if (msg.includes('频繁') || msg.includes('稍后再')) {
      await sleep(3000 * (attempt + 1))
      continue
    }
    if (String(json.ret_code) !== '1') {
      throw new Error(msg || `ret_code ${json.ret_code}`)
    }
    return json.data
  }
  throw new Error('多次限流失败')
}

function loadStore() {
  if (!fs.existsSync(OUT)) return { fetched_at: null, byId: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(OUT, 'utf8'))
    return { fetched_at: raw.fetched_at, byId: raw.byId || {} }
  } catch {
    return { fetched_at: null, byId: {} }
  }
}

function saveStore(byId) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    JSON.stringify({ fetched_at: new Date().toISOString(), byId }, null, 2),
    'utf8',
  )
}

function listCourses() {
  return Object.entries(nationalCourseData).flatMap(([province, list]) =>
    list.map((c) => ({ ...c, province })),
  )
}

function courseToTsObject(c) {
  const lines = ['    {']
  lines.push(`      id: ${JSON.stringify(c.id)},`)
  lines.push(`      name: ${JSON.stringify(c.name)},`)
  lines.push(`      city: ${JSON.stringify(c.city || '')},`)
  lines.push(`      total_par: ${c.total_par ?? 72},`)
  if (c.holes_par?.length) lines.push(`      holes_par: [${c.holes_par.join(', ')}],`)
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

function applyLive(course, live) {
  const locked = lock[course.id]
  if (locked) {
    const sections = locked.sections.map((s) => ({ name: s.name, holes_par: [...s.holes_par] }))
    const holes_par = flatSections(sections)
    return {
      ...course,
      name: locked.name || course.name,
      total_par: holes_par.reduce((sum, n) => sum + n, 0),
      holes_par,
      sections,
    }
  }
  const sameCount = (course.sections || []).length === live.length
  const sections = live.map((s, i) => ({
    name: sameCount ? course.sections[i].name : s.name,
    holes_par: [...s.holes_par],
  }))
  const holes_par = flatSections(sections)
  return {
    ...course,
    total_par: holes_par.reduce((sum, n) => sum + n, 0),
    holes_par,
    sections,
  }
}

function writeNational(byProvince) {
  const header = fs.readFileSync(TS_PATH, 'utf8').split('export const nationalCourseData')[0]
  const refreshed = header.replace(
    / \* 洞杆复核:.*\n/,
    '',
  )
  const stamp = ` * 洞杆复核: ${new Date().toISOString()}（ApiGolflive5/club_get，锁定三家不改）\n`
  const head = refreshed.includes(' * 生成:')
    ? refreshed.replace(' * 生成:', `${stamp} * 生成:`)
    : refreshed
  const provKeys = Object.keys(byProvince)
  const tsParts = [head.trimEnd(), 'export const nationalCourseData: Record<string, NationalCourse[]> = {']
  for (const p of provKeys) {
    tsParts.push(`  ${JSON.stringify(p)}: [`)
    for (const c of byProvince[p]) tsParts.push(`${courseToTsObject(c)},`)
    tsParts.push('  ],')
  }
  tsParts.push('};', '')
  fs.writeFileSync(TS_PATH, tsParts.join('\n'), 'utf8')
}

async function main() {
  const applyOnly = process.argv.includes('--apply-only')
  const courses = listCourses()
  const store = loadStore()
  const byId = store.byId

  if (!applyOnly) {
    const pending = courses.filter((c) => !byId[c.id]?.ok)
    console.log(`待拉 ${pending.length} / ${courses.length}`)
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i]
      process.stdout.write(`[${i + 1}/${pending.length}] ${c.name} … `)
      try {
        const detail = await fetchDetail(c.id)
        const sections = liveSections(detail)
        if (!sections) {
          byId[c.id] = { ok: false, error: '半场杆数不完整' }
          console.log('SKIP 半场不完整')
        } else {
          byId[c.id] = {
            ok: true,
            live_name: detail?.club?.club_name || '',
            sections,
          }
          const oldFlat = flatSections(c.sections)
          const newFlat = flatSections(sections)
          console.log(samePars(oldFlat, newFlat) ? 'same' : 'DIFF')
        }
      } catch (e) {
        byId[c.id] = { ok: false, error: e.message }
        console.log(`FAIL ${e.message}`)
      }
      if ((i + 1) % 15 === 0) saveStore(byId)
      if (i < pending.length - 1) await sleep(380)
    }
    saveStore(byId)
  }

  const changed = []
  const lockedDiff = []
  const failed = []
  const byProvince = {}
  for (const [province, list] of Object.entries(nationalCourseData)) {
    byProvince[province] = list.map((c) => {
      const live = byId[c.id]
      if (!live?.ok) {
        failed.push({ id: c.id, name: c.name, error: live?.error || '未拉取' })
        return c
      }
      const oldFlat = flatSections(c.sections)
      const newFlat = flatSections(live.sections)
      const parsDiffer = !samePars(oldFlat, newFlat)
      if (lock[c.id] && parsDiffer) {
        lockedDiff.push({ id: c.id, name: c.name, old: oldFlat, live: newFlat })
      } else if (parsDiffer) {
        changed.push({
          id: c.id,
          name: c.name,
          province,
          old: oldFlat,
          live: newFlat,
          oldSections: c.sections,
          liveSections: live.sections,
        })
      }
      if (!parsDiffer) return c
      return applyLive(c, live.sections)
    })
  }

  writeNational(byProvince)

  const report = {
    refreshed_at: new Date().toISOString(),
    courses: courses.length,
    changed: changed.length,
    locked_diff: lockedDiff.length,
    failed: failed.length,
    changed_courses: changed.map((c) => ({
      id: c.id,
      name: c.name,
      province: c.province,
      old: c.old,
      live: c.live,
    })),
    locked_diff: lockedDiff,
    failed,
  }
  const reportPath = path.join(__dirname, 'output/par-refresh-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n改洞杆 ${changed.length}，锁定但线上不同 ${lockedDiff.length}，失败 ${failed.length}`)
  console.log(`报告 ${reportPath}`)
  for (const c of changed) {
    console.log(`  ${c.province} ${c.name}`)
    console.log(`    旧 ${c.old.join(',')}`)
    console.log(`    新 ${c.live.join(',')}`)
  }
  for (const c of lockedDiff) {
    console.log(`  锁定未改 ${c.name}`)
    console.log(`    库 ${c.old.join(',')}`)
    console.log(`    线上 ${c.live.join(',')}`)
  }
  if (failed.length) {
    console.log('失败:')
    for (const f of failed) console.log(`  ${f.name}: ${f.error}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
