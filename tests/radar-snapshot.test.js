import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRadarSnapshot,withRadarFallback} from '../radar-snapshot.js';
const now=Date.parse('2026-11-24T15:04:00+08:00');
const source={schema:1,checkedAt:now-1000,feeds:{sectors:{rows:[{code:'BK1000',name:'行业',pct:1.2,turnover:1000000}],receivedAt:now-60000,marketDate:'2026-11-24',source:'东财',error:''},breadth:{rows:[],receivedAt:0,error:'源异常'}}};
test('server snapshot rescues sector display despite browser CORS failure, retains real clock',async()=>{
 const snapshot=parseRadarSnapshot(source,{now});
 const r=await withRadarFallback('sectors',async()=>{throw Error('Failed to fetch')},{snapshotLoader:async()=>snapshot});
 assert.equal(r.rows[0].code,'BK1000');assert.equal(r.receivedAt,now-60000);assert.equal(r.historical,true);assert.match(r.warning,/非实时/);
});
test('missing or expired data does not become an invented market reading',async()=>{
 const snapshot=parseRadarSnapshot(source,{now:now+97*3600000});assert.equal(snapshot.feeds.sectors.rows.length,0);
 await assert.rejects(withRadarFallback('breadth',async()=>{throw Error('offline')},{snapshotLoader:async()=>snapshot}),/源异常/);
});
