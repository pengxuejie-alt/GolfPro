import fs from 'fs';

const s = fs.readFileSync('d:/golfpro/dist/build/mp-weixin/pages/CreateMatch.js', 'utf8');

// extract H: and I: bindings in picker block
const hMatch = s.match(/H:(\w+\.value|\w+),I:e\.o\([^)]+\)/);
console.log('H binding:', hMatch?.[0]?.slice(0, 120));

// find searchKey ref name - ref("")
const emptyRefs = [...s.matchAll(/(\w+)=e\.ref\(\"\"\)/g)];
console.log('empty refs:', emptyRefs.map((m) => m[1]));

// find C: button and nearby H:
const cBtn = s.indexOf('发布并开球');
console.log('context around publish:', s.slice(cBtn - 80, cBtn + 120));

const pickerBlock = s.indexOf('选择球场');
console.log('picker area:', s.slice(pickerBlock, pickerBlock + 500));

// Check 3f16395 version - build old commit