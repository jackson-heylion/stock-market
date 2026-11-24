import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateBot,dailyBars,capPercent} from './bot.js';
import {getQuotes} from './market.js';
import {getMarketIndices,getSectors,getRankings,getWatchQuotes} from './market-center.js';
import {fees,feeTotal} from './engine.js';
import {SECURITIES} from './seed.js';
import {AFTERNOON_VERSION,POLICY,round,clock,afternoonWindow,fresh,scoreStock,holdingDecision} from './afternoon-rules.js';
const validCode=c=>/^(?:60|68|00|30)\d{4}$/.test(c);
function trade(next,h,stock,q,action,reason,now){
 if(!fresh(q,now)||q.code!==stock.code||!Number.isFinite(q.prevClose)||q.prevClose<=0)return {status:'阻断',reason:'报价失效'};
 const buy=action==='OPEN'||action==='ADD',side=buy?'BUY':'SELL',cap=capPercent(stock.code,stock.name),upper=round(q.prevClose*(1+cap)),lower=round(q.prevClose*(1-cap)),price=round(q.price*(1+(buy?1:-1)*POLICY.slippage));
 if(price>=upper-.01||price<=lower+.01)return {status:'阻断',reason:'滑点后接近涨跌停，不假设可成交'};
 if(!buy&&(!h||h.buyDate>=clock(now).date))return {status:'阻断',reason:'T+1或持仓不足'};
 let qty=0;
 if(buy){
  const max=Math.min(next.cash,Math.max(0,next.initialCash*POLICY.positionFraction-(h?h.quantity*q.price:0)),next.initialCash*(h?.quantity?.valueOf()?0.025:POLICY.entryFraction));
  qty=Math.floor(max/price/100)*100;
  while(qty>0&&round(qty*price)+feeTotal(fees(side,round(qty*price)))>max)qty-=100;
 }else qty=action==='CLEAR'?h.quantity:Math.floor(h.quantity*(action==='REDUCE'&&reason.includes('盈利15%')?1/3:.5)/100)*100;
 if(qty<100)return {status:'阻断',reason:'预算或可操作股数不足100股'};
 const gross=round(qty*price),fee=feeTotal(fees(side,gross)),date=clock(now).date;
 const item={id:'A'+date.replace(/-/g,'')+'-'+stock.code,code:stock.code,name:stock.name,side,date,quantity:qty,price,gross,fee,modelId:AFTERNOON_VERSION,reason,quoteTime:new Date(q.time).toISOString(),executedAt:new Date(now).toISOString(),source:q.source+' + 0.1%不利滑点（盘中模拟）'};
 if(buy){const cost=round((h?.cost||0)+gross+fee),quantity=(h?.quantity||0)+qty;next.cash=round(next.cash-gross-fee);next.holdings[stock.code]={...h,code:stock.code,name:stock.name,quantity,cost,avgCost:cost/quantity,buyDate:date,lastPrice:q.price,lastPriceDate:date,modelId:AFTERNOON_VERSION};}
 else {const basis=round(h.cost*qty/h.quantity);item.pnl=round(gross-fee-basis);next.cash=round(next.cash+gross-fee);if(qty===h.quantity)delete next.holdings[stock.code];else{h.quantity-=qty;h.cost=round(h.cost-basis);h.avgCost=h.cost/h.quantity;h.lastPrice=q.price;h.lastPriceDate=date;}}
 next.trades.push(item);
 // Supersede only same-symbol prior pending instructions after an actual execution. Daily scanner remains separate.
 next.pending=next.pending.filter(p=>p.code!==stock.code);
 return {status:'模拟已成交',trade:item,reason};
}
export function decideAfternoon(account,snapshot,now=Date.now()){
 validateBot(account);const {date}=clock(now);
 if(!afternoonWindow(now)||account.afternoon?.date===date)return {state:account,changed:false,message:'窗口外或本日已执行，拒绝重复/补记'};
 const next=structuredClone(account),results=[],scores=[],quotes=snapshot.quotes||{},stocks=snapshot.stocks||[],prior=snapshot.previousDate;
 const benchmark=snapshot.indices||[],indexOk=['sh000001','sz399001','sz399006'].every(key=>benchmark.some(q=>q.key===key&&fresh(q,now,60000)&&Number.isFinite(q.pct)));
 const marketOk=indexOk&&benchmark.filter(x=>['sh000001','sz399001','sz399006'].includes(x.key)).filter(q=>q.pct>=0).length>=2;
 if(!indexOk||!prior||prior>=date)return {state:account,changed:false,message:'交易日或三大指数未核验，拒绝成交'};
 for(const s of stocks)scores.push(scoreStock(s,{quote:quotes[s.code],rank:snapshot.ranks?.[s.code],daily:snapshot.daily?.[s.code],previousDate:prior,now}));
 const by=new Map(scores.map(s=>[s.code,s]));let buys=0,sells=0;
 for(const h of Object.values(next.holdings)){
  const q=quotes[h.code],signal=by.get(h.code),d=holdingDecision(h,q,signal,now);let out={status:'观察',reason:d.reason};
  if(d.action==='CLEAR'||d.action==='REDUCE'){if(sells<POLICY.maxSells){out=trade(next,h,h,q,d.action,d.reason,now);if(out.trade)sells++;}else out={status:'阻断',reason:'单日卖出次数上限'};}
  else if(d.action==='ADD'){if(marketOk&&next.models.M5.enabled&&buys<POLICY.maxBuys){out=trade(next,h,h,q,d.action,d.reason,now);if(out.trade)buys++;}else out={status:'阻断',reason:'市场/模型/买入上限限制'};}
  results.push({code:h.code,name:h.name,action:d.action,...out});
 }
 const candidates=scores.filter(s=>s.passed&&!next.holdings[s.code]&&!results.some(r=>r.code===s.code)).sort((a,b)=>b.ratio-a.ratio||b.sectorPct-a.sectorPct||a.code.localeCompare(b.code));
 for(const s of candidates){
  if(!marketOk||!next.models.M5.enabled||buys>=POLICY.maxBuys||Object.keys(next.holdings).length>=next.models.M5.maxPositions){results.push({code:s.code,name:s.name,action:'OPEN',status:'阻断',reason:'市场/模型/持仓/买入上限限制'});continue;}
  const out=trade(next,null,s,quotes[s.code],'OPEN',s.reason,now);if(out.trade)buys++;
  results.push({code:s.code,name:s.name,action:'OPEN',...out});
 }
 // Do not finalize when every candidate/holding lacks current data; a fresh retry within the window remains possible.
 if(!scores.some(s=>s.price!==null)&&!Object.keys(account.holdings).some(c=>fresh(quotes[c],now)))return {state:account,changed:false,message:'股票行情或成交量不足，未执行，窗口内可重试'};
 next.afternoon={version:AFTERNOON_VERSION,date,checkedAt:new Date(now).toISOString(),marketOk,indices:benchmark.map(({key,pct,time})=>({key,pct,time})),scores,results,message:'模拟买入 '+buys+' 笔、卖出 '+sells+' 笔；未触发则不交易'};
 next.updatedAt=new Date(now).toISOString();
 validateBot(next);
 return {state:next,changed:true,message:next.afternoon.message};
}
export async function collectAfternoon(account){
 const [sectors,indices,bench]=await Promise.all([getSectors(),getMarketIndices(),dailyBars('sh000001')]);
 const today=clock(Date.now()).date,previousDate=bench.filter(x=>x.date<today).at(-1)?.date;
 const leaders=sectors.rows.filter(s=>s.pct>=POLICY.sectorMin&&s.turnover>0).slice(0,3);
 const parts=await Promise.allSettled(leaders.map(s=>getRankings('turnover','all',{sectorCode:s.code,size:30})));
 const selected=new Map();
 parts.forEach((p,i)=>{if(p.status!=='fulfilled')return;const sector=leaders[i];for(const st of p.value.rows.filter(s=>validCode(s.code)&&!/ST/i.test(s.name)&&s.pct>=.8&&s.pct<=5).slice(0,4)){const prev=selected.get(st.code);if(!prev||sector.pct>prev.sectorPct)selected.set(st.code,{code:st.code,name:st.name,sector:sector.name,sectorPct:sector.pct,sectorTime:sector.quoteTime});}});
 // Manual account research is limited to the curated observation pool, not assumed actual holdings.
 for(const s of [...SECURITIES.filter(s=>!s.halted),...Object.values(account.holdings)])if(!selected.has(s.code))selected.set(s.code,{code:s.code,name:s.name});
 const stocks=[...selected.values()],daily={};
 for(let i=0;i<stocks.length;i+=6){const batch=stocks.slice(i,i+6);await Promise.allSettled(batch.map(async s=>{daily[s.code]=await dailyBars(s.code);}));}
 // Quotes are fetched LAST, after slow daily history collection. No stale execution.
 const codes=stocks.map(s=>s.code);
 const [q,r,latestIndices]=await Promise.all([getQuotes(codes),getWatchQuotes(codes),getMarketIndices()]);
 return {previousDate,stocks,daily,quotes:Object.fromEntries(q.quotes.map(s=>[s.code,s])),ranks:Object.fromEntries(r.map(s=>[s.code,s])),indices:latestIndices};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const path=fileURLToPath(new URL('./data/bot.json',import.meta.url));
 const account=validateBot(JSON.parse(readFileSync(path,'utf8')));
 if(!afternoonWindow(Date.now()))console.log('窗口外，不执行');
 else collectAfternoon(account).then(snapshot=>{const result=decideAfternoon(account,snapshot,Date.now());console.log(result.message);if(result.changed&&!process.argv.includes('--dry-run'))writeFileSync(path,JSON.stringify(result.state,null,2)+'\n');else if(!result.changed&&afternoonWindow(Date.now())&&!account.afternoon?.date?.includes(clock(Date.now()).date))process.exitCode=2;}).catch(err=>{console.error('行情核验失败，未改变账户',err);process.exitCode=2;});
}
