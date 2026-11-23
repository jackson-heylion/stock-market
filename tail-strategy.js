// Explainable read-only intraday defensive strategy for the browser-local manual account.
// The user explicitly triggers each SELL, and the engine validates the real local ledger.
// No buys, no after-close fills, no stale quotes, no hidden automatic balance changes.
import {positions,shDate} from './engine.js';
import {quoteState,session} from './market.js';

export const TAIL_POLICY=Object.freeze({
 version:'tail-risk-2026-11-23-v1',
 stopCostPct:-6,
 weakDayPct:-5,
 weakCostPct:-3,
 profitProtectPct:15,
 profitIntradayPeakPct:9.6,
 maxOrders:3,
 maxSellFraction:0.5,
 note:'弱市控制回撤，不追涨；只使用当前浏览器实际持仓和不超过15秒的真实时间戳报价。'
});
const halfLots=q=>Math.floor(q*TAIL_POLICY.maxSellFraction/100)*100;
function priceLimit(code,name){
 if(/\*?ST/i.test(name))return .05;
 return /^(30|68)/.test(code)?.20:.10;
}
export function proposeTailOrders(state,quotes,{now=Date.now()}={}){
 const date=shDate(new Date(now)),tradeOpen=session(now)==='open';
 const report={date,version:TAIL_POLICY.version,source:'浏览器本地手动账本 + 当前行情',tradeOpen,rows:[],orders:[]};
 for(const p of positions(state)){
  const q=quotes[p.code],quality=quoteState(q,now);
  const qty=p.quantity,avg=p.totalCost/qty;
  const base={code:p.code,quantity:qty,lastBuyDate:p.lastBuyDate,avgCost:avg,
   price:Number.isFinite(q?.price)?q.price:null,
   todayPct:Number.isFinite(q?.pct)?q.pct:null,
   profitPct:quality.fresh?((q.price/avg)-1)*100:null,
   quoteTime:q?.time||null,quoteSource:q?.source||'无可用行情'};
  let reason='',qtyToSell=0;
  if(!tradeOpen||!quality.tradable){reason='未取得有效15秒内盘中报价，暂不拟成交';}
  else if(p.lastBuyDate>=date){reason='今日买入，按现有保守T+1规则暂不可卖';}
  else if(!Number.isFinite(q?.prevClose)||q.prevClose<=0){reason='缺少昨收价，无法核对涨跌停';}
  else if(q.price<=q.prevClose*(1-priceLimit(p.code,q.name))+.01){reason='接近跌停，不能保证可卖';}
  else{
   const costPct=base.profitPct;
   if(costPct<=TAIL_POLICY.stopCostPct){
    reason='相对持仓均价回撤超过6%，建议减半防守';qtyToSell=halfLots(qty);
   }else if(q.pct<=TAIL_POLICY.weakDayPct&&costPct<=TAIL_POLICY.weakCostPct){
    reason='今日跌幅超过5%且持仓浮亏超过3%，建议减半';qtyToSell=halfLots(qty);
   }else if(costPct>=TAIL_POLICY.profitProtectPct&&q.pct<TAIL_POLICY.profitIntradayPeakPct){
    reason='相对成本盈利15%以上且未封涨停，可分批止盈';qtyToSell=Math.floor(qty/3/100)*100;
   }else{
    reason='未触发卖出规则：继续观察，不追高加仓';
   }
  }
  if(qtyToSell<=0&&reason.includes('建议减半'))reason+='；持仓不足200股，不执行';
  const row={...base,reason,side:qtyToSell>0?'SELL':'HOLD',suggestedQty:qtyToSell};
  report.rows.push(row);
 }
 report.orders=report.rows.filter(r=>r.side==='SELL').sort((a,b)=>
   a.profitPct-b.profitPct||a.code.localeCompare(b.code)).slice(0,TAIL_POLICY.maxOrders);
 return report;
}
