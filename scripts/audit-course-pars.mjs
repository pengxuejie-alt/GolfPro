/**
 * 国内球场洞杆核对队列。
 * 用法: node scripts/audit-course-pars.mjs
 *
 * 已核对的球场见 scripts/data/par-verified-lock.json，本脚本只检查是否被改动。
 * 国外球场不在本队列，国内洞杆对齐 GolfLive 之后再加。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { nationalCourseData } from '../src/data/nationalCourses.ts'
import { gdCourseData } from '../src/data/guangdongCourses.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/par-verified-lock.json'), 'utf8'))

function samePars(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n, i) => n === b[i])
}

const courses = Object.entries(nationalCourseData).flatMap(([province, list]) =>
  list.map((c) => ({ ...c, province })),
)

const byShape = {}
const unnamed = []
const multi = []
for (const c of courses) {
  const secs = c.sections || []
  const shape = secs.length ? secs.map((s) => s.holes_par.length).join('+') : `holes:${c.holes_par?.length || 0}`
  byShape[shape] = (byShape[shape] || 0) + 1
  if (secs.filter((s) => s.name === '半场').length >= 2) unnamed.push(`${c.province} ${c.name}`)
  if (secs.length > 2) {
    multi.push(`${c.province} ${c.name}（${secs.map((s) => s.name).join('/')}）`)
  }
}

console.log(`国内球场 ${courses.length}，省份 ${Object.keys(nationalCourseData).length}`)
console.log('洞数结构', byShape)
console.log(`半场名仍是「半场」: ${unnamed.length}`)
console.log(`27 洞及以上（按半场组合，不是单一 18 洞）: ${multi.length}`)

console.log('\n已核对（锁定）')
for (const [id, row] of Object.entries(lock.courses)) {
  const found = courses.find((c) => c.id === id)
  const want = row.sections.flatMap((s) => s.holes_par)
  const got = found?.sections?.flatMap((s) => s.holes_par) || found?.holes_par || []
  const ok = found && samePars(want, got)
  console.log(`  ${ok ? 'OK' : 'DRIFT'} ${row.name} ${id} ${ok ? '' : `库内 ${got.join(',')}`}`)
}

function loose(name) {
  return String(name || '').replace(/\s+/g, '').replace(/[()（）]/g, '')
}

console.log('\n广东手工库与全国库洞杆不一致（全国库已有两九洞时，手工库不会覆盖）')
let diff = 0
for (const list of Object.values(gdCourseData)) {
  for (const gc of list) {
    const gPars = gc.sections?.flatMap((s) => s.holes_par) || gc.holes_par || []
    const hit = courses.find((c) => {
      const a = loose(c.name)
      const b = loose(gc.name)
      return a.includes(b) || b.includes(a)
    })
    if (!hit) {
      console.log(`  仅手工库 ${gc.name}`)
      diff += 1
      continue
    }
    const nPars = hit.sections?.flatMap((s) => s.holes_par) || hit.holes_par || []
    if (!samePars(gPars, nPars)) {
      diff += 1
      console.log(`  ${gc.name}`)
      console.log(`    手工 ${gPars.join(',')}`)
      console.log(`    全国 ${nPars.join(',')}`)
    }
  }
}
if (!diff) console.log('  无')

console.log('\n下一步: 用 GolfLive openid 跑 npm run fetch:golflive-courses，再 npm run build:national-courses。')
console.log('锁定的三家在生成时会写回本文件里的洞杆。国外球场等国内这一步完成后再加。')
