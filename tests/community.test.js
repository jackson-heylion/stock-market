import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommunity,communityReport,classifyCommunity} from '../community.js';
const now=Date.parse('2026-11-24T09:00:00+08:00'),at=new Date(now-60000).toISOString();
const payload={schema:1,fetchedAt:at,boards:[{code:'300308',board:'中际旭创',status:'ok'}],posts:Array.from({length:12},(_,i)=>({id:String(100000+i),code:'300308',board:'中际旭创',title:'芯片'+i+(i<8?'看多':'看空'),publishedAt:at,comments:i,reads:100}))};
test('community snapshot verifies dates, codes, URLs and provenance',()=>{
 const x=structuredClone(payload);x.posts.push({...x.posts[0],id:'999999',publishedAt:new Date(now+1).toISOString()},{...x.posts[0],id:'888888',code:'bad'});
 const r=parseCommunity(x,{now});assert.equal(r.rows.length,12);assert.match(r.rows[0].url,/^https:\/\/guba\.eastmoney\.com\/news,300308,/);
 assert.throws(()=>parseCommunity({...payload,fetchedAt:new Date(now-3*3600000).toISOString()},{now}),/过期/);
});
test('opinion classification handles slang and disagreement',()=>{
 assert.equal(classifyCommunity('看多加仓').tone,'positive');assert.equal(classifyCommunity('诱多砸盘').tone,'negative');assert.equal(classifyCommunity('看多但谨防砸盘').tone,'mixed');assert.equal(classifyCommunity('不要追高').tone,'negative');
});
test('community report separates sample size and directional score',()=>{
 const r=communityReport(parseCommunity(payload,{now}).rows,{now});
 assert.equal(r.total,12);assert.equal(r.counts.positive,8);assert.equal(r.counts.negative,4);assert.equal(r.score,33);assert.equal(r.boards[0].count,12);
 assert.equal(communityReport(r.rows.slice(0,3),{now}).score,null);
});
test('empty source is not synthetic neutral sentiment',()=>{
 assert.throws(()=>parseCommunity({...payload,posts:[],boards:[{status:'unavailable'}]},{now}),/未取得/);
});
