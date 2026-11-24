import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateFearGreed,fearGreedLabel} from '../fear-greed.js';
const now=Date.parse('2026-11-24T10:00:00+08:00');
const make=(sign=1)=>{
 const feed=rows=>({rows,updatedAt:now-1000,error:''});
 return {breadth:feed([{up:sign>0?4800:100,down:sign>0?100:4800,flat:100}]),
 indices:feed(['sh000001','sz399001','sz399006'].map(key=>({key,pct:sign*3,time:now-1000}))),
 sectors:feed(Array.from({length:36},(_,i)=>({code:'BK'+(1000+i),pct:sign}))),
 news:feed(Array.from({length:12},(_,i)=>({title:'行业'+i+(sign>0?'上涨':'下跌'),time:now-1000})))};
};
test('broad strength and weakness produce bounded opposite risk appetite',()=>{
 const strong=calculateFearGreed(make(1),now),weak=calculateFearGreed(make(-1),now);
 assert.ok(strong.score>=76);assert.ok(weak.score<=24);assert.equal(strong.coverage,100);
 assert.equal(strong.label,'极度贪婪');assert.equal(weak.label,'极度恐慌');
});
test('missing news is optional but never fabricated or treated as neutral',()=>{
 const data=make(1);data.news.rows=[];const r=calculateFearGreed(data,now);
 assert.equal(r.coverage,85);assert.equal(r.factors.find(x=>x.id==='news').score,null);assert.ok(r.score>75);
});
test('missing/stale core evidence, lunch and wrong-day indices suppress composite',()=>{
 for(const mutate of [d=>d.breadth.error='unavailable',d=>d.sectors.rows=d.sectors.rows.slice(0,10),d=>d.indices.rows[0].time-=86400000,d=>d.breadth.updatedAt-=180000]){
  const d=make(1);mutate(d);assert.equal(calculateFearGreed(d,now).score,null);
 }
 assert.equal(calculateFearGreed(make(1),Date.parse('2026-11-24T12:00:00+08:00')).score,null);
 assert.equal(calculateFearGreed({},now).score,null);
});
test('neutral and boundary labels are deterministic',()=>{
 const d=make(1);d.breadth.rows=[{up:2500,down:2500,flat:0}];d.indices.rows.forEach(x=>x.pct=0);d.sectors.rows.forEach((x,i)=>x.pct=i%2?1:-1);d.news.rows=[];
 assert.equal(calculateFearGreed(d,now).score,50);assert.equal(fearGreedLabel(24).label,'极度恐慌');assert.equal(fearGreedLabel(45).label,'中性');assert.equal(fearGreedLabel(76).label,'极度贪婪');
});
