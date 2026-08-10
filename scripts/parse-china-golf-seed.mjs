/**
 * 解析网上 382 家营业球场名单，输出条目 + GolfLive 搜索关键词
 * 来源：高尔夫大师杂志「382家全名单」
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SOURCE_CANDIDATES = [
  path.join(__dirname, 'data/china-golf-seed-382-full.txt'),
  path.join(__dirname, '../data/china-golf-seed-382.md'),
  'C:/Users/XIAO KA/.cursor/projects/d-golfpro/agent-tools/b7421e9e-db29-4b22-86a3-99f00cc38c60.txt',
]

/** 名单正文里条目常连写为「…俱乐部)2. 下一项」 */
function parse382Entries(text) {
  const start = text.indexOf('中国高尔夫球场名单')
  const body = start >= 0 ? text.slice(start) : text
  const re = /\d+\.\s*(.+?)(?=\d+\.\s|$)/gs
  const entries = []
  let m
  while ((m = re.exec(body)) !== null) {
    let name = m[1].replace(/\s+/g, ' ').trim()
    name = name.replace(/\([^)]*\)/g, '').trim()
    name = name.replace(/更多精彩欢迎.*$/s, '').trim()
    if (/高尔夫|球会|俱乐部|球场|果岭/.test(name) && name.length >= 4 && name.length <= 80) {
      entries.push(name)
    }
  }
  return entries
}

function searchKeywordFromEntry(name) {
  let s = name
    .replace(/^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|宁夏|新疆|西藏)[^ golf]*/g, '')
    .replace(/(市|区|县|自治州|自治县)/g, '')
  s = s.replace(/(国际|乡村|度假|温泉|山地|海滨|森林|湿地|半岛|庄园|体育|公园|练习场)/g, '')
  s = s.replace(/(高尔夫|球会|俱乐部|球场|果岭|场)/g, '')
  s = s.trim()
  if (s.length >= 2 && s.length <= 8) return s
  const m = name.match(/([\u4e00-\u9fa5]{2,6})(?:高尔夫|球会|俱乐部)/)
  return m ? m[1] : name.slice(-6, -2)
}

function main() {
  let text = ''
  for (const p of SOURCE_CANDIDATES) {
    if (fs.existsSync(p)) {
      text = fs.readFileSync(p, 'utf8')
      console.log(`源文件: ${p}`)
      break
    }
  }
  if (!text) {
    console.error('未找到 382 名单源文件')
    process.exit(1)
  }

  const entries = parse382Entries(text)
  const keywords = [...new Set(entries.map(searchKeywordFromEntry).filter((k) => k && k.length >= 2))]

  const dataDir = path.join(__dirname, 'data')
  fs.mkdirSync(dataDir, { recursive: true })

  const entriesPath = path.join(dataDir, 'china-golf-seed-382.json')
  fs.writeFileSync(entriesPath, JSON.stringify({ count: entries.length, entries }, null, 2), 'utf8')

  const kwPath = path.join(dataDir, 'golflive-search-keywords.json')
  fs.writeFileSync(kwPath, JSON.stringify({ count: keywords.length, keywords }, null, 2), 'utf8')

  console.log(`解析 ${entries.length} 条球场 → ${entriesPath}`)
  console.log(`提取 ${keywords.length} 个搜索词 → ${kwPath}`)
}

main()
