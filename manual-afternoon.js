import {SECURITIES} from './seed.js';
import {positions,executeTrade,budgetQuantity,cloneState,validateState} from './engine.js';
import {getQuotes,fetchTimeout,parseKline} from './market.js';
import {getMarketIndices,getSectors,getRankings,getWatchQuotes} from './market-center.js';
import {AFTERNOON_VERSION,POLICY,round,clock,afternoonWindow,fresh,scoreStock,holdingDecision} from './afternoon-rules.js';
export const MANUAL_VERSION=AFTERNOON_VERSION+'-local';
const supported=SECURITIES.filter(s=>!s.halted);
const codeMap=new Map(supported.map(s=>[s.code,s]));
const cap=s=>/ST/i.test(s.name)?.05:/^(300|301|688|689)/.test(s.code)?.20:.10;
const indexKeys=['sh000001','sz399001','sz399006'];
async function rawDaily(code){
 const secid=code==='sh000001'?'1.000001':(code.startsWith('6')?'1.':'0.')+code;
 const q=new URLSearchParams({secid,fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57',klt:'101',fqt:'0',beg:'20250101',end:'20500101',lmt:'35'});
 const bars=parseKline(await fetchTimeout('https://push2his.eastmoney.com/api/qt/stock/kline/get?'+q,'json',fetch,9000));
 if(!bars.length)throw Error('缺少未复权日K '+code);
 return bars;
}
export async function collectManualAfternoon({proxy=''}={}){
 const codes=supported.map(s=>s.code),daily={};
 const [bench,boards]=await Promise.allSettled([rawDaily('sh000001'),getSectors()]);
 const date=clock(Date.now()).date,previousDate=bench.status==='fulfilled'?bench.value.filter(b=>b.date<date).at(-1)?.date:null;
 const leaders=boards.status==='fulfilled'?boards.value.rows.filter(s=>s.pct>=POLICY.sectorMin&&s.turnover>0).slice(0,3):[];
 const parts=await Promise.allSettled([
  ...codes.map(async code=>{daily[code]=await rawDaily(code);}),
  ...leaders.map(s=>getRankings('turnover','all',{sectorCode:s.code,size:30}))
 ]);
 const membership=new Map();
 leaders.forEach((sector,i)=>{const p=parts[codes.length+i];if(p.status!=='fulfilled')return;for(const s of p.value.rows)if(codeMap.has(s.code)&&(!membership.has(s.code)||sector.pct>membership.get(s.code).sectorPct))membership.set(s.code,{sector:sector.name,sectorPct:sector.pct,sectorTime:sector.quoteTime});});
 const [quotes,ranks,indices]=await Promise.allSettled([getQuotes(codes,{proxy}),getWatchQuotes(codes),getMarketIndices()]);
 return {previousDate,daily,stocks:supported.map(s=>({...s,...membership.get(s.code)})),quotes:Object.fromEntries((quotes.status==='fulfilled'?quotes.value.quotes:[]).map(q=>[q.code,q])),ranks:Object.fromEntries((ranks.status==='fulfilled'?ranks.value:[]).map(q=>[q.code,q])),indices:indices.status==='fulfilled'?indices.value:[]};
}
export function planManualAfternoon(state,snapshot,now=Date.now()){
 const date=clock(now).date,holds=positions(state),by=new Map(holds.map(h=>[h.code,h]));
 const indices=snapshot.indices||[],indexOk=indexKeys.every(key=>indices.some(q=>q.key===key&&fresh(q,now,60000)&&Number.isFinite(q.pct)));
 const marketOk=indexOk&&indexKeys.filter(key=>indices.find(q=>q.key===key)?.pct>=0).length>=2;
 const stocks=(snapshot.stocks||[]).filter(s=>codeMap.has(s.code)),stockBy=new Map(stocks.map(s=>[s.code,s]));
 const rows=[];
 for(const s of supported){
  const h=by.get(s.code),q=snapshot.quotes?.[s.code],rank=snapshot.ranks?.[s.code],signal=scoreStock(stockBy.get(s.code)||s,{quote:q,rank,daily:snapshot.daily?.[s.code],previousDate:snapshot.previousDate,now});
  const price=fresh(q,now)&&q.code===s.code?q.price:null;
  const d=h?holdingDecision({...h,avgCost:h.totalCost/h.quantity,buyDate:h.lastBuyDate},q,signal,now):{action:signal.passed?'OPEN':'HOLD',reason:signal.reason};
  let action=d.action,reason=d.reason,quantity=0,limitPrice=null;
  if(state.trades.some(t=>t.code===s.code&&t.date===date)){action='HOLD';reason='本日已有该股成交，避免重复操作';}
  if((action==='ADD'||action==='OPEN')&&!marketOk){action='HOLD';reason='三大指数未通过买入风控';}
  if(action==='OPEN'&&holds.length>=3){action='HOLD';reason='当前持仓已达3只以上，不扩大持仓范围';}
  if(action!=='HOLD'){
   const buying=action==='OPEN'||action==='ADD';
   const upper=round(q.prevClose*(1+cap(s))),lower=round(q.prevClose*(1-cap(s)));
   limitPrice=round(price*(buying?1+POLICY.slippage:1-POLICY.slippage));
   if(!Number.isFinite(limitPrice)||limitPrice>=upper-.01||limitPrice<=lower+.01){action='HOLD';reason='滑点后接近涨跌停，拒绝假设成交';}
   else if(buying){const budget=Math.min(state.cash,state.initialCash*(action==='ADD'?.025:POLICY.entryFraction),Math.max(0,state.initialCash*POLICY.positionFraction-(h?h.quantity*price:0)));quantity=budgetQuantity(budget,limitPrice);}
   else quantity=action==='CLEAR'?h.quantity:Math.floor(h.quantity*d.fraction/100)*100;
   if(action!=='HOLD'&&quantity<100){action='HOLD';reason='预算或可操作数量不足100股';}
  }
  rows.push({code:s.code,name:s.name,held:h?.quantity||0,price,pnl:price&&h?round((price/(h.totalCost/h.quantity)-1)*100):null,day:price&&q.prevClose>0?round((price/q.prevClose-1)*100):null,action,reason,quantity:action==='HOLD'?0:quantity,limitPrice:action==='HOLD'?null:limitPrice,quoteTime:price?q.time:null,source:price?q.source:null,signal});
 }
 // Prioritize clear/defensive sells, then existing-position additions, then new entries.
 const priority={CLEAR:0,REDUCE:1,ADD:2,OPEN:3,HOLD:4};
 rows.sort((a,b)=>priority[a.action]-priority[b.action]||(a.pnl??0)-(b.pnl??0)||a.code.localeCompare(b.code));
 return {date,checkedAt:new Date(now).toISOString(),marketOk,indexOk,rows};
}
export function applyManualAfternoon(state,snapshot,now=Date.now()){
 if(!validateState(state))return {ok:false,error:'账本未通过校验'};
 if(!afternoonWindow(now))return {ok:false,error:'仅北京时间交易日14:30–14:55执行，不倒填成交'};
 const date=clock(now).date;
 if(state.manualAfternoon?.date===date||state.trades.some(t=>t.date===date&&t.strategyVersion===MANUAL_VERSION))return {ok:false,error:'今日本地策略已执行，禁止重复'};
 const plan=planManualAfternoon(state,snapshot,now);
 if(!plan.indexOk||!snapshot.previousDate||snapshot.previousDate>=date)return {ok:false,error:'交易日指数或历史日期未核验，不执行',plan};
 const holds=positions(state);
 if(holds.some(h=>!plan.rows.some(r=>r.code===h.code&&r.price!==null)))return {ok:false,error:'存在持仓无15秒内有效行情，未写入账本',plan};
 if(!plan.rows.some(r=>r.price!==null))return {ok:false,error:'无有效报价，未写入账本',plan};
 const next=cloneState(state);let buys=0,sells=0;
 for(const row of plan.rows){
  if(row.action==='HOLD'){row.status='观察';continue;}
  const buying=['ADD','OPEN'].includes(row.action);
  if(buying&&buys>=POLICY.maxBuys||!buying&&sells>=POLICY.maxSells){row.status='阻断';row.reason='每日操作次数上限';continue;}
  if(row.action==='OPEN'&&positions(next).length>=3){row.status='阻断';row.reason='持仓上限';continue;}
  const out=executeTrade(next,{code:row.code,side:buying?'BUY':'SELL',quantity:row.quantity,price:row.limitPrice,date});
  if(!out.ok){row.status='阻断';row.reason=out.error;continue;}
  Object.assign(out.trade,{strategyVersion:MANUAL_VERSION,reason:row.reason,quoteTime:new Date(row.quoteTime).toISOString(),executedAt:new Date(now).toISOString(),source:row.source+' + 0.1%不利滑点（本地模拟）'});
  row.status='模拟已成交';row.tradeId=out.trade.id;
  if(buying)buys++;else sells++;
 }
 next.manualAfternoon={version:MANUAL_VERSION,...plan,message:'本地模拟买入 '+buys+' 笔、卖出 '+sells+' 笔'};
 if(!validateState(next))return {ok:false,error:'结果校验失败，未写入'};
 return {ok:true,state:next,plan:next.manualAfternoon,message:next.manualAfternoon.message};
}
