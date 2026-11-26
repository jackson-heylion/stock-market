import {readFileSync,writeFileSync} from 'node:fs';
import {validateBot} from '../bot.js';
import {collectStrategy,planStrategy,applyWave} from '../dual-strategy.js';
import {session} from '../market.js';
const file='data/bot.json',account=validateBot(JSON.parse(readFileSync(file,'utf8'))),mode=process.env.WAVE_MODE||'review';
const chosen=(process.env.WAVE_SELECTION||'').split(',').map(s=>s.trim()).filter(Boolean);
if(chosen.length>30||chosen.some(s=>!/^(?:60|68|00|30)\d{4}:(?:OPEN|ADD|REDUCE|CLEAR)$/.test(s)))throw Error('无效指令，拒绝写入');
if(mode==='selected'&&!chosen.length)throw Error('未选中交易指令');
let state=structuredClone(account);
if(!state.waveMigratedAt){state.legacyPending=[...(state.legacyPending||[]),...state.pending];state.pending=[];state.waveMigratedAt=new Date().toISOString();}
const evidence=JSON.parse(readFileSync('data/wave-evidence.json','utf8')).securities||{};
if(mode==='selected')state.waveIntent={selected:[...new Set(chosen)],createdAt:new Date().toISOString()};
if(mode==='cancel')delete state.waveIntent;
const pending=state.waveIntent;if(pending&&Date.now()-Date.parse(pending.createdAt)>96*3600000)delete state.waveIntent;
const snapshot=await collectStrategy(state,'wave',{evidence,extraCodes:(state.waveIntent?.selected||[]).map(x=>x.split(':')[0])});
const now=Date.now(),plan=planStrategy(state,snapshot,'wave',now);
if(session(now)==='open'&&['scheduled','selected'].includes(mode)){
 const keys=state.waveIntent?.selected||plan.rows.filter(r=>r.executable&&(mode!=='scheduled'||plan.phase==='连续交易')).map(r=>r.code+':'+r.action);
 const result=applyWave(state,snapshot,keys,now);state=result.state;
 if(state.waveIntent&&keys.length){const retry=keys.filter(k=>{const row=plan.rows.find(r=>r.code+':'+r.action===k);return row&&row.action!=='HOLD'&&!row.executable;});if(retry.length)state.waveIntent.selected=retry;else delete state.waveIntent;}
}else state.wavePlan={...plan,results:[]};
state.updatedAt=new Date().toISOString();validateBot(state);
writeFileSync(file,JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify({mode,phase:plan.phase,candidates:plan.rows.length,passed:plan.rows.filter(r=>r.passed.length).length,results:state.wavePlan.results,pending:state.waveIntent||null}));
