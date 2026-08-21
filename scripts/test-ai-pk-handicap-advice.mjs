import assert from 'node:assert/strict';
import {
  buildAiPkHandicapAdvice,
  computeRecentHandicapsForPlayers,
} from '../src/utils/aiPkHandicapAdvice.ts';

const players = [
  { id: 'a', nickname: '张三', handicap: 18 },
  { id: 'b', nickname: '李四', handicap: 12 },
  { id: 'c', nickname: '王五', handicap: 22 },
];

const holes = Array.from({ length: 18 }, (_, i) => ({
  par: 4,
  scores: [5 + (i % 2), 4, 6],
}));

const rules = [
  {
    id: 'r1',
    type: 'strokes',
    name: '比杆挂洞',
    baseScore: 1,
    playerIds: ['a', 'b'],
    summary: '2人单挂/平打',
    profitsByPlayerId: { a: -6, b: 6, c: 0 },
  },
  {
    id: 'r2',
    type: 'tiger',
    name: '打老虎',
    baseScore: 1,
    playerIds: ['a', 'b', 'c'],
    summary: '打老虎',
    profitsByPlayerId: { a: 3, b: -1, c: -2 },
  },
  {
    id: 'r3',
    type: 'landlord',
    name: '斗地主',
    baseScore: 1,
    playerIds: ['a', 'b', 'c'],
    summary: '斗地主',
    profitsByPlayerId: { a: -2, b: 5, c: -3 },
  },
];

const recentMatches = [
  {
    match_id: 'm1',
    status: 2,
    kickoff_time: '2026-08-01',
    user_list: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    hole_scores: Array.from({ length: 18 }, () => ({ scores: [90, 84, 94] })),
  },
  {
    match_id: 'm2',
    status: 2,
    kickoff_time: '2026-08-10',
    user_list: [{ id: 'a' }, { id: 'b' }],
    hole_scores: Array.from({ length: 18 }, () => ({ scores: [88, 82] })),
  },
];

const recentHcp = computeRecentHandicapsForPlayers(recentMatches, players, { maxMatches: 3 });
assert.ok(recentHcp.a.avg != null);
assert.ok(recentHcp.b.avg != null);

const recent3 = buildAiPkHandicapAdvice({
  mode: 'recent3',
  players,
  holes,
  rules,
  isFinished: true,
  recentHandicaps: recentHcp,
});
assert.equal(recent3.ready, true);
assert.ok(recent3.sections.some((s) => s.title === '单挂'));
assert.ok(recent3.sections.some((s) => s.title === '打老虎'));
assert.ok(recent3.sections.some((s) => s.title === '斗地主'));
const danGua = recent3.sections.find((s) => s.title === '单挂');
assert.ok(danGua && danGua.lines.some((l) => l.includes('让')));

const current = buildAiPkHandicapAdvice({
  mode: 'current',
  players,
  holes,
  rules,
  isFinished: true,
});
assert.equal(current.ready, true);
assert.ok(current.sections.some((s) => s.title === '单挂'));

const notReady = buildAiPkHandicapAdvice({
  mode: 'current',
  players,
  holes: holes.map((h) => ({ par: 4, scores: [0, 0, 0] })),
  rules,
  isFinished: false,
});
assert.equal(notReady.ready, false);

console.log('test-ai-pk-handicap-advice: ok');
