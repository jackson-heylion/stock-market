import {SECURITIES} from './seed.js';
import {positions,budgetQuantity} from './engine.js';
import {POLICY,clock,fresh,scoreStock,round,strategyWindow} from './afternoon-rules.js';
const curated=new Set(SECURITIES.map(s=>s.code));
const eligible=s=>s&&/^(?:60|68|00|30)\d{4}$/.test(s.code)&&typeof s.name==='string'&&s.name.trim()&&s.name.length<=40&&!/ST|退市|退$|^N|^C/i.test(s.name)&&Number.isFinite(s.price)&&s.price>0&&Number.isFinite(s.turnover)&&s.turnover>0;
const byTurnover=(a,b)=>b.turnover-a.turnover||a.code.localeCompare(b.code);
export function discoverStocks(groups=[],fallback=[],held=[]){
 const skip=new Set([...held,...curated]),found=new Map();
 for(const {sector,rows} of groups.slice(0,3)){
  if(!sector||!Number.isFinite(sector.pct)||sector.pct<POLICY.sectorMin)continue;
  for(const s of [...rows].filter(s=>eligible(s)&&!skip.has(s.code)).sort(byTurnover).slice(0,4)){
   const old=found.get(s.code);
   if(!old||sector.pct>old.sectorPct)found.set(s.code,{code:s.code,name:s.name,sector:sector.name,sectorPct:sector.pct,sectorTime:sector.quoteTime,discoverySource:'强势行业成交额前列'});
  }
 }
 for(const s of [...fallback].filter(s=>eligible(s)&&!skip.has(s.code)).sort(byTurnover)){
  if(found.size>=12)break;
  if(!found.has(s.code))found.set(s.code,{code:s.code,name:s.name,discoverySource:'全市场成交额榜样本（行业待核）'});
 }
 return [...found.values()].slice(0,12);
}
const fmt=n=>Number.isFinite(n)?n.toFixed(2):'待核';
export function candidateChecks(s,snapshot,state,now,slot='afternoon'){
 const q=snapshot.quotes?.[s.code],rank=snapshot.ranks?.[s.code],signal=scoreStock(s,{quote:q,rank,daily:snapshot.daily?.[s.code],previousDate:snapshot.previousDate,now,slot,minute:snapshot.minutes?.[s.code]});
 const current=fresh(q,now)&&q.code===s.code&&Number.isFinite(q.prevClose)&&q.prevClose>0,price=current?q.price:null,prev=current?q.prevClose:null,date=clock(now).date;
 const checks=[],add=(name,condition,actual,pass)=>checks.push({name,condition,actual,status:pass===true?'通过':pass===false?'不通过':'待核'});
 const keys=['sh000001','sz399001','sz399006'],indices=snapshot.indices||[];
 const indexOk=keys.every(k=>indices.some(x=>x.key===k&&fresh(x,now,60000)&&Number.isFinite(x.pct))),rising=keys.filter(k=>indices.find(x=>x.key===k)?.pct>=0).length;
 add('市场方向','三大指数至少两只非负，60秒内有效',indexOk?rising+'/3':'指数待核',indexOk?rising>=2:null);
 add('报价','当日15秒内、昨收有效',current?fmt(price)+'元':'缺有效报价',current?true:null);
 const sectorFresh=Number.isFinite(s.sectorPct)&&Number.isFinite(s.sectorTime)&&s.sectorTime<=now&&now-s.sectorTime<=120000&&clock(s.sectorTime).date===date;
 add('行业强度','涨幅≥1%，120秒内行业行情',sectorFresh?fmt(s.sectorPct)+'%':'行业或时间待核',sectorFresh?s.sectorPct>=POLICY.sectorMin:null);
 const measured=signal.checks.length>0,check=i=>measured?signal.checks[i]?.pass:null;
 add('放量',slot==='opening'?'前五分钟量/前5日五分钟均量代理≥1.8':'当日累计量/前5日全天均量≥1.3',fmt(signal.ratio)+'倍',check(1));
 add('趋势','价格高于前20个完整交易日均线',Number.isFinite(signal.ma20)?'价格 '+fmt(price)+' / MA20 '+fmt(signal.ma20):'日K待核',check(2));
 add('涨幅与承接','涨幅0.8%–5%，回撤≤2%，不低于开盘价'+(slot==='opening'?'，09:35承接确认':''),measured?'涨幅 '+fmt(signal.gain)+'% / 回撤 '+fmt(signal.fade)+'% / 开盘 '+fmt(signal.open):'量价待核',check(3));
 const cap=/^(300|301|302|688|689)/.test(s.code)?.20:.10,slip=current?round(price*(1+POLICY.slippage)):null;
 const limitOk=current?slip<round(prev*(1+cap))-.01&&slip>round(prev*(1-cap))+.01:null;
 add('可成交性','0.1%滑点后远离涨跌停',current?'参考 '+fmt(slip)+'元':'报价待核',limitOk);
 const modelOk=checks.every(c=>c.status==='通过'),missing=checks.some(c=>c.status==='待核'),holds=positions(state);
 const budget=Math.max(0,Math.min(state.cash,state.initialCash*POLICY.entryFraction)),quantity=slip&&limitOk?budgetQuantity(budget,slip):0;
 const gates=[];
 if(holds.length>=3)gates.push('持仓已达3只');
 if(state.trades.some(t=>t.date===date&&t.code===s.code))gates.push('今日该股已有成交');
 if(state.trades.filter(t=>t.date===date&&t.side==='BUY'&&/M5-(?:0935|1430)/.test(t.strategyVersion||'')).length>=POLICY.maxBuys)gates.push('每日策略买入上限');
 if(current&&quantity<100)gates.push('现金不足一手');
 if(!strategyWindow(now,slot))gates.push('非执行窗口');
 gates.push('新标仅研究，未纳入手动交易白名单');
 return {code:s.code,name:s.name,sector:s.sector||'待核',discoverySource:s.discoverySource,price,quoteTime:current?q.time:null,source:current?q.source:null,signal,checks,modelOk,judgment:modelOk?'满足M5开仓条件':missing?'待核验，不开仓':'不满足，不开仓',gates,ma20:signal.ma20??null,priceBand:prev?{min:round(prev*1.008),max:round(prev*1.05)}:null,budget,quantity,stopPrice:quantity>=100?round(slip*.94):null};
}
export function buildDiscoveryPlan(state,snapshot,now,slot){
 const held=new Set(positions(state).map(h=>h.code));
 return (snapshot.discovered||[]).filter(s=>!held.has(s.code)&&!curated.has(s.code)).slice(0,12).map(s=>candidateChecks(s,snapshot,state,now,slot)).sort((a,b)=>Number(b.modelOk)-Number(a.modelOk)||b.checks.filter(x=>x.status==='通过').length-a.checks.filter(x=>x.status==='通过').length||(b.signal.ratio||0)-(a.signal.ratio||0)||a.code.localeCompare(b.code));
}
