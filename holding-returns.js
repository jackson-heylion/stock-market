import {shDate} from './engine.js';
const round=n=>Math.round(n*100)/100;
const valid=n=>Number.isFinite(n)&&n>0;
const dateAt=t=>shDate(new Date(t));
export function holdingReturns({holdings=[],trades=[],quotes={},cash,initialCash,date=shDate(),now=Date.now(),robot=false}){
 const active=new Map(holdings.map(h=>[h.code,h])),by=new Map();
 for(const t of trades){
  if(!by.has(t.code))by.set(t.code,[]);
  by.get(t.code).push(t);
 }
 const codes=new Set([...active.keys(),...trades.filter(t=>t.date===date).map(t=>t.code)]);
 const rows=[];
 for(const code of codes){
  const h=active.get(code),list=by.get(code)||[],today=list.filter(t=>t.date===date),q=quotes[code],qty=h?.quantity||0;
  const sameDay=q&&q.code===code&&valid(q.price)&&Number.isFinite(q.time)&&q.time<=now&&dateAt(q.time)===date;
  const price=sameDay?q.price:(h?.quote??h?.lastPrice??null),cost=h?(h.totalCost??h.cost):0;
  const value=qty===0?0:valid(price)?round(qty*price):null;
  const delta=today.reduce((n,t)=>n+(t.side==='BUY'?t.quantity:-t.quantity),0),openingQty=qty-delta;
  const flow=t=>t.side==='BUY'?-(t.gross+t.fee):t.gross-t.fee;
  const dayFlow=today.reduce((s,t)=>s+flow(t),0);
  const previousValue=openingQty===0?0:sameDay&&valid(q.prevClose)&&openingQty>0?round(openingQty*q.prevClose):null;
  // Flat positions need no current price; today purchases need no previous close.
  const day=openingQty>=0&&previousValue!==null&&(qty===0||sameDay)&&value!==null?round(value-previousValue+dayFlow):null;
  const unrealized=value!==null&&Number.isFinite(cost)?round(value-cost):null;
  let realized=null;
  if(robot){
   const sells=list.filter(t=>t.side==='SELL');
   if(sells.every(t=>Number.isFinite(t.pnl)))realized=round(sells.reduce((n,t)=>n+t.pnl,0));
  }else{
   let held=0,basis=0,pnl=0;
   for(const t of list){
    if(t.side==='BUY'){held+=t.quantity;basis=round(basis+t.gross+t.fee);}
    else if(held>=t.quantity){const allocated=basis/held*t.quantity;held-=t.quantity;basis=round(Math.max(0,basis-allocated));pnl=round(pnl+t.gross-t.fee-allocated);}
   }
   realized=pnl;
  }
  const cumulative=unrealized===null||realized===null?null:round(unrealized+realized);
  rows.push({code,name:h?.name||list.at(-1)?.name||code,quantity:qty,price,value,unrealized,realized,day,cumulative,previousValue,dayQuoteTime:sameDay?q.time:null,priceDate:sameDay?date:h?.priceDate??h?.lastPriceDate??null});
 }
 const total=Number.isFinite(cash)&&rows.every(r=>r.value!==null)?round(cash+rows.reduce((n,r)=>n+r.value,0)):null;
 const day=rows.every(r=>r.day!==null)?round(rows.reduce((n,r)=>n+r.day,0)):null;
 const cumulative=total!==null&&valid(initialCash)?round(total-initialCash):null;
 const base=day!==null&&total!==null?total-day:null;
 return {rows,day,cumulative,total,dayRate:valid(base)?day/base*100:null,cumulativeRate:cumulative!==null?cumulative/initialCash*100:null,date,missing:rows.filter(r=>r.day===null).length};
}
