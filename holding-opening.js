// One-off opening risk rules. Pure, deterministic, no real orders.
import {positions,executeTrade,validateState} from './engine.js';
import {quoteState} from './market.js';
import {SECURITIES} from './seed.js';
export const HOLD_POLICY=Object.freeze({version:'opening-hold-20261124-v1',date:'2026-11-24',
 start:'09:36',end:'09:44',stopCostPct:-6,weakDayPct:-5,weakCostPct:-3,
 profitPct:15,gapPct:3,fadePct:1.5,highVolFadePct:2.5,maxOrders:3,slippage:0.001});
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const good=n=>Number.isFinite(n)&&n>0;
export function holdClock(now){
 const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
 const v=k=>p.find(x=>x.type===k)?.value;
 return {date:[v('year'),v('month'),v('day')].join('-'),clock:v('hour')+':'+v('minute')};
}
export function holdWindow(now=Date.now()){
 const c=holdClock(now);return c.date===HOLD_POLICY.date&&c.clock>=HOLD_POLICY.start&&c.clock<=HOLD_POLICY.end;
}
export function assessHolding(holding,q,trend,{now=Date.now(),name='',date=HOLD_POLICY.date}={}){
 const {code,quantity,avgCost,buyDate}=holding;
 const base={code,quantity,avgCost,price:q?.price??null,quoteTime:q?.time??null,
  quoteSource:q?.source??null,profitPct:null,side:'HOLD',suggestedQty:0};
 const block=reason=>({...base,status:'阻断',reason});
 if(!holdWindow(now)||date!==HOLD_POLICY.date)return block('不在一次性09:36–09:44窗口');
 if(!Number.isInteger(quantity)||quantity<100||quantity%100||!good(avgCost))return block('持仓数量或成本无效');
 if(!buyDate||buyDate>=date)return block('T+1或买入日期未核验');
 if(!q||q.code!==code||!quoteState(q,now).tradable||!Number.isFinite(q.time)||q.time>now||
    holdClock(q.time).date!==date||holdClock(q.time).clock<'09:35'||!good(q.price)||!good(q.prevClose))
  return block('缺少当日有效15秒内报价/昨收');
 const prev=trend?.prevClose;
 if(!good(prev)||Math.abs(prev/q.prevClose-1)>.005)return block('分时昨收与报价不一致');
 const minute=trend?.bars||[];
 const bars=['09:31','09:32','09:33','09:34','09:35'].map(t=>minute.find(b=>b.date===date+' '+t));
 if(bars.some(b=>!b||!good(b.price)||!Number.isFinite(b.volume)||b.volume<0)||bars.reduce((s,b)=>s+b.volume,0)<=0)
  return block('五根完整分钟行情或成交量缺失');
 const open=minute.find(b=>b.date===date+' 09:30')?.open||bars[0].open;
 if(!good(open))return block('开盘价缺失');
 const close=bars.at(-1).price,cap=/\*?ST/i.test(name||q.name||'')?.05:/^(30|68)/.test(code)?.2:.1;
 const upper=round(q.prevClose*(1+cap)),lower=round(q.prevClose*(1-cap));
 const price=round(q.price*(1-HOLD_POLICY.slippage));
 if(q.price>upper+.01||q.price<=lower+.01||price<=lower+.01||!good(price))return block('跌停或滑点后价格不可模拟成交');
 const profit=(q.price/avgCost-1)*100,day=(q.price/q.prevClose-1)*100;
 const gap=(open/q.prevClose-1)*100,fade=(close/open-1)*100;
 const isHighVol=/^(30|68)/.test(code),threshold=isHighVol?HOLD_POLICY.highVolFadePct:HOLD_POLICY.fadePct;
 let fraction=0,reason='未触发风控，继续持有',priority=9;
 if(profit<=HOLD_POLICY.stopCostPct){fraction=.5;reason='相对成本亏损达到6%，减半防守';priority=0;}
 else if(day<=HOLD_POLICY.weakDayPct&&profit<=HOLD_POLICY.weakCostPct){fraction=.5;reason='当日跌5%且浮亏3%，减半';priority=1;}
 else if(gap>=HOLD_POLICY.gapPct&&fade<=-threshold&&q.price<=close*1.005&&q.price<open){
  fraction=1/3;reason='高开至少3%后五分钟承接失败，减三分之一';priority=2;
 }else if(profit>=HOLD_POLICY.profitPct&&q.price<upper-.02&&q.price<open&&close<open){
  fraction=1/3;reason='盈利15%以上且开盘转弱，分批锁定收益';priority=3;
 }
 const suggestedQty=Math.floor(quantity*fraction/100)*100;
 return {...base,profitPct:round(profit),dayPct:round(day),gapPct:round(gap),fadePct:round(fade),
  fiveMinuteClose:close,executionPrice:price,priority,reason:fraction&&!suggestedQty?reason+'；不足一手':reason,
  suggestedQty,side:suggestedQty?'SELL':'HOLD',status:suggestedQty?'待模拟卖出':'继续持有'};
}
export function applyLocalOpening(state,quotes,trends,{now=Date.now()}={}){
 if(!holdWindow(now))return {state,rows:[],changed:false};
 if(!validateState(state))throw Error('本地账本校验失败');
 const date=HOLD_POLICY.date,next=structuredClone(state);
 const executed=next.trades.filter(t=>t.date===date&&t.strategyVersion===HOLD_POLICY.version&&t.side==='SELL');
 const sold=new Set(executed.map(t=>t.code));
 const rows=positions(next).map(p=>{
  if(sold.has(p.code))return {code:p.code,quantity:p.quantity,status:'已执行',side:'HOLD',reason:'今日已按开盘策略减仓，不重复卖出'};
  const s=SECURITIES.find(s=>s.code===p.code);
  if(!s||s.halted)return {code:p.code,side:'HOLD',status:'阻断',reason:'停牌或未知股票'};
  return assessHolding({...p,avgCost:p.totalCost/p.quantity,buyDate:p.lastBuyDate},quotes[p.code],trends[p.code],{now,name:s.name,date});
 });
 let count=0;
 const orders=rows.filter(r=>r.side==='SELL').sort((a,b)=>a.priority-b.priority||a.profitPct-b.profitPct||a.code.localeCompare(b.code));
 for(const r of orders){
  if(executed.length+count>=HOLD_POLICY.maxOrders){r.status='阻断';r.reason+='；当日自动减仓笔数达到上限';continue;}
  const result=executeTrade(next,{code:r.code,side:'SELL',quantity:r.suggestedQty,price:r.executionPrice,date});
  if(!result.ok){r.status='阻断';r.reason=result.error;continue;}
  Object.assign(result.trade,{strategyVersion:HOLD_POLICY.version,reason:r.reason,quoteTime:new Date(r.quoteTime).toISOString(),
   executedAt:new Date(now).toISOString(),source:r.quoteSource+' + 0.1%不利滑点'});
  r.status='模拟已成交';count++;
 }
 if(count&&!validateState(next))throw Error('模拟卖出后账本校验失败');
 return {state:count?next:state,rows,changed:count>0};
}
