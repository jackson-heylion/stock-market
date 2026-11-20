import {BUDGET_PER_STOCK, FEE_RULES, INITIAL_CASH, MODEL_DEFINITIONS, SECURITIES, SEED_SIGNALS, SNAPSHOT_DATE} from './seed.js';
export const STORAGE_KEY = 'stock-market-paper-mvp-v1';
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const priceOK = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1_000_000;
export function fees(side, gross, rules=FEE_RULES){
  return {commission:round2(Math.max(rules.minCommission,gross*rules.commissionRate)),transfer:round2(gross*rules.transferRate),stamp:side==='SELL'?round2(gross*rules.sellStampRate):0};
}
export function feeTotal(f){return round2(f.commission+f.transfer+f.stamp);}
export function shDate(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date).replace(/\//g,'-');}
export function initialState(){
  const state={version:1,createdAt:'2026-11-19T15:00:00+08:00',initialCash:INITIAL_CASH,cash:INITIAL_CASH,watchlist:SECURITIES.map(s=>s.code),prices:Object.fromEntries(SECURITIES.filter(s=>s.close).map(s=>[s.code,{price:s.close,date:SNAPSHOT_DATE,source:'历史收盘快照'}])),trades:[],signals:structuredClone(SEED_SIGNALS)};
  for(const s of SECURITIES){
    if(s.halted) continue;
    const qty=budgetQuantity(BUDGET_PER_STOCK,s.close);
    const result=executeTrade(state,{code:s.code,side:'BUY',quantity:qty,price:s.close,date:SNAPSHOT_DATE,seed:true});
    if(!result.ok) throw Error('Seed transaction invalid: '+s.code+' '+result.error);
  }
  return state;
}
export function budgetQuantity(budget,price){
  if(!priceOK(price)||!Number.isFinite(budget)||budget<0)return 0;
  let q=Math.floor(budget/price/100)*100;
  while(q>0){const gross=round2(q*price); if(round2(gross+feeTotal(fees('BUY',gross)))<=budget)return q; q-=100;}
  return 0;
}
export function positions(state){
  const p={};
  for(const t of state.trades){
    const row=p[t.code]??={code:t.code,quantity:0,totalCost:0,lastBuyDate:null,realized:0};
    if(t.side==='BUY'){row.quantity+=t.quantity;row.totalCost=round2(row.totalCost+t.gross+t.fee);row.lastBuyDate=t.date;}
    else{
      const avg=row.quantity?row.totalCost/row.quantity:0;
      row.quantity-=t.quantity;row.totalCost=round2(Math.max(0,row.totalCost-avg*t.quantity));row.realized=round2(row.realized+t.gross-t.fee-avg*t.quantity);
    }
  }
  return Object.values(p).filter(p=>p.quantity>0);
}
export function executeTrade(state,{code,side,quantity,price,date=shDate(),seed=false}){
  const s=SECURITIES.find(x=>x.code===code);
  if(!s) return {ok:false,error:'未知证券代码'};
  if(s.halted) return {ok:false,error:'停牌股票禁止模拟成交'};
  if(!['BUY','SELL'].includes(side))return {ok:false,error:'无效交易方向'};
  if(!Number.isInteger(quantity)||quantity<=0||quantity%100!==0)return {ok:false,error:'数量须为100股的正整数倍'};
  if(!priceOK(price))return {ok:false,error:'无效价格'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return {ok:false,error:'无效日期'};
  const gross=round2(quantity*price),fee=feeTotal(fees(side,gross));
  if(side==='BUY'&&round2(gross+fee)>state.cash)return {ok:false,error:'可用资金不足（含交易费用）'};
  if(side==='SELL'){
    const p=positions(state).find(p=>p.code===code);
    if(!p||p.quantity<quantity)return {ok:false,error:'持仓数量不足'};
    // Conservative: if a security was bought today, do not sell any shares today.
    if(p.lastBuyDate>=date)return {ok:false,error:'A股T+1：该股票当日买入后不可当日卖出'};
  }
  const item={id:`T${String(state.trades.length+1).padStart(4,'0')}`,code,side,quantity,price,date,gross,fee,seed:!!seed};
  state.cash=round2(state.cash+(side==='BUY'? -gross-fee:gross-fee));
  state.trades.push(item);
  return {ok:true,trade:item};
}
export function portfolio(state){
  const holds=positions(state).map(p=>{
    const stock=SECURITIES.find(s=>s.code===p.code),quote=state.prices[p.code]?.price??stock.referencePrice??0;
    const value=round2(p.quantity*quote),unrealized=round2(value-p.totalCost);
    return {...p,name:stock.name,quote,value,unrealized,avgCost:p.totalCost/p.quantity,priceDate:state.prices[p.code]?.date??null};
  });
  const marketValue=round2(holds.reduce((x,p)=>x+p.value,0)),total=round2(state.cash+marketValue);
  return {holds,marketValue,cash:state.cash,total,profit:round2(total-state.initialCash),profitRate:(total-state.initialCash)/state.initialCash*100};
}
export function markPrice(state,code,price,date=shDate()){
  const stock=SECURITIES.find(s=>s.code===code);
  if(!stock||stock.halted)return {ok:false,error:'停牌或未知证券不能更新可交易报价'};
  if(!priceOK(price))return {ok:false,error:'请输入有效价格'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return {ok:false,error:'无效日期'};
  state.prices[code]={price:round2(price),date,source:'用户手动维护（未经核验）'};
  return {ok:true};
}
export function modelEvidence(state,code,modelId){
  const model=MODEL_DEFINITIONS.find(m=>m.id===modelId),stock=SECURITIES.find(s=>s.code===code);
  if(!model||!stock)return null;
  const flags=state.signals?.[code]?.[modelId]??model.checks.map(()=>0);
  return {flags,confirmed:flags.filter(x=>x===1).length,total:model.checks.length,contradicted:flags.some(x=>x===-1)};
}
export function validateState(state){
  if(!state||state.version!==1||!Number.isFinite(state.cash)||state.cash<0||state.initialCash!==INITIAL_CASH||!Array.isArray(state.trades)||state.trades.length>20000||!Array.isArray(state.watchlist)||!state.prices||!state.signals)return false;
  const seen=new Set(),validCodes=new Set(SECURITIES.map(s=>s.code));
  for(const t of state.trades){
    if(!t||!validCodes.has(t.code)||!['BUY','SELL'].includes(t.side)||!priceOK(t.price)||!Number.isInteger(t.quantity)||t.quantity<=0||t.quantity%100!==0||!Number.isFinite(t.gross)||!Number.isFinite(t.fee)||typeof t.date!=='string')return false;
    if(!t.id||seen.has(t.id))return false;
    seen.add(t.id);
  }
  for(const c of state.watchlist)if(!validCodes.has(c))return false;
  for(const [c,p] of Object.entries(state.prices))if(!validCodes.has(c)||!priceOK(p?.price)||typeof p.date!=='string')return false;
  for(const [c,ms] of Object.entries(state.signals)){if(!validCodes.has(c))return false;for(const [m,flags] of Object.entries(ms)){const model=MODEL_DEFINITIONS.find(x=>x.id===m);if(!model||!Array.isArray(flags)||flags.length!==model.checks.length||flags.some(x=>![1,0,-1].includes(x)))return false;}}
  // Replay transactions to prevent impossible cash/holdings in imported files.
  const clean={cash:INITIAL_CASH,trades:[]};
  for(const t of state.trades){const r=executeTrade(clean,{...t,seed:t.seed});if(!r.ok)return false;const out=r.trade;if(Math.abs(out.gross-t.gross)>0.01||Math.abs(out.fee-t.fee)>0.01)return false;}
  return Math.abs(clean.cash-state.cash)<0.02;
}
export function cloneState(state){return JSON.parse(JSON.stringify(state));}
