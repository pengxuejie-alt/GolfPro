/**
 * 解析网上 382 家球场名单，提取 GolfLive 搜索关键词
 * 来源：微信公众号「382家全名单」（已缓存到 agent-tools）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SOURCE_CANDIDATES = [
  path.join(__dirname, '../data/china-golf-seed-382.md'),
  'C:/Users/XIAO KA/.cursor/projects/d-golfpro/agent-tools/b7421e9e-db29-4b22-86a3-99f00cc38c60.txt',
]

function extractKeywords(text) {
  const keys = new Set()
  // 条目形如 "12. 北京海淀区万柳高尔夫俱乐部"
  const re = /\d+\.\s*[^0-9\n]{4,80}?(?:高尔夫|球会|俱乐部|球场|乡村)/g
  for (const m of text.match(re) || []) {
    let s = m.replace(/^\d+\.\s*/, '')
    s = s.replace(/\([^)]*\)/g, '')
    s = s.replace(/(北京市|天津市|上海市|重庆市|广东省|江苏省|浙江省|福建省|河北省|山西省|辽宁省|吉林省|黑龙江省|安徽省|江西省|山东省|河南省|湖北省|湖南省|海南省|四川省|贵州省|云南省|陕西省|甘肃省|青海省|内蒙古|广西|宁夏|新疆|西藏)/g, '')
    s = s.replace(/[\d+洞A-Z场]/g, ' ')
    const parts = s.split(/[、，,\s]+/).filter(Boolean)
    for (const p of parts) {
      const t = p.trim()
      if (t.length >= 2 && t.length <= 8 && !/^\d/.test(t)) keys.add(t)
    }
    // 整段短名
    const short = s.replace(/(国际|乡村|度假|温泉|山地|海滨|森林|湿地|半岛|庄园|体育|公园)/g, '').trim()
    if (short.length >= 2 && short.length <= 6) keys.add(short)
  }
  return [...keys]
}

function main() {
  let text = ''
  for (const p of SOURCE_CANDIDATES) {
    if (fs.existsSync(p)) {
      text = fs.readFileSync(p, 'utf8')
      break
    }
  }
  if (!text) {
    console.error('未找到 382 名单源文件')
    process.exit(1)
  }
  const keywords = extractKeywords(text)
  const out = path.join(__dirname, 'data', 'golflive-search-keywords.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ count: keywords.length, keywords }, null, 2), 'utf8')
  console.log(`提取 ${keywords.length} 个搜索词 → ${out}`)
}

main()
