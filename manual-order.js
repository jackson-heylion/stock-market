// A manual quote-based paper fill is separate from strategy signals and the remote wave ledger.
import {validSymbol,registeredStock,registerSecurity,cloneState,validateState,executeTrade,shDate} from './engine.js';
import {session,validPrice} from './market.js';
const fail=error=>({ok:false,error});
const round=n=>Math.round(n*100)/100;
export function manualQuoteCheck(state,security,q,now=Date.now()){
 const code=security?.code,name=security?.name;
 if(!validSymbol(code)||typeof name!=='string'||!name.trim()||name.length>40||/[<>\x00-\x1f]|ST|退市|退$|^N|^C/i.test(name))return fail('仅支持已核验的沪深普通A股；ST、退市及上市初期特殊证券暂不支持');
 const known=registeredStock(state,code);
 if(known?.halted)return fail('该证券在账本标记为停牌，暂不支持成交');
 if(session(now)!=='open')return fail('非连续交易时段，仅可查看参考行情');
 if(q?.code!==code||q.name!==name||!validPrice(q.price)||!validPrice(q.prevClose)||!Number.isFinite(q.time)||q.time>now||now-q.time>15000||shDate(new Date(q.time))!==shDate(new Date(now))||typeof q.source!=='string'||!q.source.trim())return fail('未取得15秒内身份、昨收、时间及来源一致的报价');
 const limit=/^(30|68)/.test(code)?.20:.10;
 if(q.price>=round(q.prevClose*(1+limit))-.01||q.price<=round(q.prevClose*(1-limit))+.01)return fail('接近涨跌停，无法核验可成交性');
 return {ok:true,price:round(q.price)};
}
export function applyManualOrder(state,{security,quote,side,quantity,previewPrice,now=Date.now()}){
 if(!validateState(state))return fail('本地账本校验失败');
 const check=manualQuoteCheck(state,security,quote,now);if(!check.ok)return check;
 if(!validPrice(previewPrice)||Math.abs(check.price/previewPrice-1)>.005)return fail('报价较预览变动超过0.5%，请重新确认');
 const next=cloneState(state),code=security.code;
 if(!registeredStock(next,code)){
  if(side!=='BUY')return fail('未持有该证券，不可卖出');
  const registered=registerSecurity(next,{code,name:security.name,quoteTime:quote.time});if(!registered.ok)return registered;
 }
 const date=shDate(new Date(now)),result=executeTrade(next,{code,side,quantity,price:check.price,date});
 if(!result.ok)return result;
 Object.assign(result.trade,{name:security.name,source:quote.source+' · 手动报价模拟',quoteTime:new Date(quote.time).toISOString(),executedAt:new Date(now).toISOString()});
 next.prices[code]={price:check.price,date,source:quote.source,markedAt:quote.time};
 if(!validateState(next))return fail('模拟成交后账本校验失败');
 return {ok:true,state:next,trade:result.trade,message:'短线模拟'+(side==='BUY'?'买入':'卖出')+' '+security.name+' '+quantity+'股，¥'+check.price.toFixed(2)};
}
