import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODES} from '../dual-strategy.js';
import {benchmarksFor} from '../model-benchmarks.js';
import {MODEL_DEFINITIONS} from '../seed.js';
test('each account has exactly one distinct historical example for every active mode',()=>{
 const all=[];
 for(const type of ['short','wave']){
  const rows=benchmarksFor(type);
  assert.deepEqual(rows.map(r=>r.id),MODES[type].map(([id])=>id));
  for(const row of rows){assert.match(row.code,/^\d{6}$/);assert.ok(row.name&&row.period&&row.fact&&row.verify);assert.equal(row.status,'待完整历史复核');assert.ok(row.sources.length&&row.sources.every(s=>new URL(s).protocol==='https:'));assert.ok(!MODEL_DEFINITIONS.some(m=>m.name===row.name));all.push(row);}
 }
 assert.equal(new Set(all.map(r=>r.code)).size,10);
 assert.equal(new Set(all.map(r=>r.name)).size,10);
 assert.deepEqual(benchmarksFor('unknown'),[]);
});
test('account benchmark display uses selected strategy and is separate from legacy and execution',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const engine=readFileSync(new URL('../dual-strategy.js',import.meta.url),'utf8');
 assert.match(app,/renderAccountBenchmarks\(strategyType\(\)\)/);
 assert.match(app,/benchmarksFor\(type\)/);
 assert.match(app,/旧版 M1–M5 研究档案（非当前账户标杆）/);
 assert.doesNotMatch(engine,/model-benchmarks|benchmarksFor/);
});
