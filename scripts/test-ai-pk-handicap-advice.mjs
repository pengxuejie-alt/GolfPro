import assert from 'node:assert/strict';
import { buildAiPkHandicapAdvice } from '../src/utils/aiPkHandicapAdvice.ts';

const players = [
  { id: 'a', nickname: '张三', handicap: 18 },
  { id: 'b', nickname: '李四', handicap: 12 },
];

const holes = Array.from({ length: 18 }, (_, i) => ({
  par: 4,
  scores: i < 18 ? [5 + (i % 2), 4] : [0, 0],
}));

const rules = [
  {
    id: 'r1',
    type: 'strokes',
    name: '比杆挂洞',
    baseScore: 1,
    playerIds: ['a', 'b'],
    summary: '2人单挂/平打/张三,李四',
    profitsByPlayerId: { a: -6, b: 6 },
  },
];

const result = buildAiPkHandicapAdvice({
  players,
  holes,
  rules,
  isFinished: true,
});

assert.equal(result.ready, true);
assert.ok(result.headline.includes('李四'));
assert.ok(result.sections.some((s) => s.title === 'PK 总榜'));
assert.ok(result.sections.some((s) => s.lines.some((l) => l.includes('让'))));

const notReady = buildAiPkHandicapAdvice({
  players,
  holes: holes.map((h) => ({ par: 4, scores: [0, 0] })),
  rules,
  isFinished: false,
});
assert.equal(notReady.ready, false);

console.log('test-ai-pk-handicap-advice: ok');
