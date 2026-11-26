// Unofficial public market-data adapters; no credentials. Return provenance and quote time.

// A valid HTTP response does not guarantee real-time exchange data.

export const POLL_MS=3000;
export const EM_UT="fa5fd1943c7b386f172d6893dbfba10b";
const PUSH2_HOSTS=["push2.eastmoney.com","68.push2.eastmoney.com","33.push2.eastmoney.com","82.push2.eastmoney.com","91.push2.eastmoney.com","18.push2.eastmoney.com"];

export function marketPrefix(code){return String(code).startsWith("6")?"1.":"0."}

export function exchangePrefix(code){return String(code).startsWith("6")?"sh":"sz"}

export function validPrice(n){return Number.isFinite(n)&&n>0&&n<1000000}

export function chinaTimestamp(raw){
 if(typeof raw==="number"&&raw>1500000000000&&raw<3500000000000)return raw;
 if(typeof raw==="number"&&raw>1500000000&&raw<3500000000)return raw*1000;
 let s=String(raw||"").trim(),m=s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
 if(!m)m=s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
 if(!m)return null;
 const [,y,mon,day,h,min,sec]=m,ts=Date.parse(y+"-"+mon+"-"+day+"T"+h+":"+min+":"+sec+"+08:00");
 return Number.isFinite(ts)?ts:null;
}

export function session(now=Date.now()){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(now));
 const p=k=>parts.find(t=>t.type===k)?.value, m=Number(p("hour"))*60+Number(p("minute"));
 if(["Sat","Sun"].includes(p("weekday")))return "closed";
 if(m>=555&&m<570)return "auction";
 return ((m>=570&&m<690)||(m>=780&&m<900))?"open":"closed";
}

export function quoteState(q,now=Date.now()){
 if(!q)return {label:"无有效报价",fresh:false,tradable:false};
 if(!q.time)return {label:"行情时间未核验",fresh:false,tradable:false};
 const age=now-q.time,s=session(now);
 if(age< -60000)return {label:"时间异常",fresh:false,tradable:false};
 if(s==="auction")return {label:"集合竞价",fresh:age<=20000,tradable:false};
 if(s!=="open")return {label:"休市/收盘参考",fresh:true,tradable:false};
 if(age>15000)return {label:"报价过期",fresh:false,tradable:false};
 return {label:"盘中报价",fresh:true,tradable:true};
}

export function parseTencent(raw,receivedAt=Date.now()){
 const rows=[];
 for(const m of String(raw).matchAll(/v_(?:sh|sz)(\d{6})="([^"\r\n]*)"/g)){
  const a=m[2].split("~"),price=Number(a[3]),prevClose=Number(a[4]);
  if(a.length<31||!validPrice(price))continue;
  rows.push({code:m[1],name:a[1],price,prevClose:validPrice(prevClose)?prevClose:null,
   pct:validPrice(prevClose)?(price-prevClose)/prevClose*100:null,
   time:chinaTimestamp(a[30]),receivedAt,source:"腾讯财经"});
 }
 return rows;
}

export function parseSina(raw,receivedAt=Date.now()){
 const quotes=[];
 for(const match of String(raw).matchAll(/var hq_str_(?:sh|sz)(\d{6})="([^"\r\n]*)"/g)){
  const f=match[2].split(","),price=Number(f[3]),prevClose=Number(f[2]);
  if(f.length<32||!validPrice(price))continue;
  quotes.push({code:match[1],name:f[0],price,prevClose:validPrice(prevClose)?prevClose:null,
  pct:validPrice(prevClose)?(price-prevClose)/prevClose*100:null,
  time:chinaTimestamp(f[30]+" "+f[31]),receivedAt,source:"新浪财经"});
 }
 return quotes;
}

export function parseEastmoney(raw,receivedAt=Date.now()){
 const diff=raw?.data?.diff;
 if(!Array.isArray(diff))return [];
 return diff.map(x=>{
 const price=Number(x.f2),prevClose=Number(x.f18),time=chinaTimestamp(x.f124||x.f86);
 if(!/^\d{6}$/.test(String(x.f12))||!validPrice(price))return null;
 return {code:String(x.f12),name:String(x.f14??""),price,prevClose:validPrice(prevClose)?prevClose:null,
  pct:validPrice(prevClose)?(price-prevClose)/prevClose*100:null,time,receivedAt,source:"东方财富"};
 }).filter(Boolean);
}

export async function fetchTimeout(url,kind,fetchImpl=fetch,timeoutMs=6500){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const resp=await fetchImpl(url,{mode:"cors",cache:"no-store",signal:controller.signal});
  if(!resp.ok)throw Error("HTTP "+resp.status);
  if(kind==="json")return resp.json();
  return new TextDecoder("gb18030").decode(await resp.arrayBuffer());
 }finally{clearTimeout(timer);}
}

function appendEmUt(url){
 if(!/^https:\/\/(?:[\w.-]+\.)?push2(?:his)?\.eastmoney\.com\//.test(url)||/[?&]ut=/.test(url))return url;
 return url+(url.includes("?")?"&":"?")+"ut="+EM_UT;
}

export async function fetchEastmoneyJson(url,fetchImpl=fetch,timeoutMs=6500,{retries=4}={}){
 const baseUrl=appendEmUt(url);
 const isPush2=/^https:\/\/push2\.eastmoney\.com\//.test(baseUrl);
 const maxAttempts=isPush2?Math.max(1,retries+1):2;
 const waitMs=fetchImpl===fetch?180:0;
 const offset=fetchImpl===fetch&&isPush2?Math.floor(Math.random()*PUSH2_HOSTS.length):0;
 let lastErr=null;
 for(let i=0;i<maxAttempts;i++){
  const host=PUSH2_HOSTS[(i+offset)%PUSH2_HOSTS.length];
  const target=i===0&&offset===0||!isPush2?baseUrl:baseUrl.replace("https://push2.eastmoney.com/","https://"+host+"/");
  try{
   return await fetchTimeout(target,"json",fetchImpl,timeoutMs);
  }catch(err){
   lastErr=err;
   const msg=String(err?.message||err);
   if(/^HTTP 4\d\d$/.test(msg))throw err;
   if(i+1<maxAttempts&&waitMs)await new Promise(r=>setTimeout(r,waitMs*(i+1)+Math.floor(Math.random()*120)));
  }
 }
 throw lastErr;
}

export async function getQuotes(symbols,{fetchImpl=fetch,now=()=>Date.now(),proxy=''}={}){
 const symbolsOk=symbols.filter(x=>/^\d{6}$/.test(x)),known=new Set(symbolsOk);
 if(proxy){
  try{
   const url=new URL(proxy);
   if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname))throw Error("代理必须使用HTTPS");
   const data=await fetchTimeout(url.origin+(url.pathname.endsWith("/")?url.pathname.slice(0,-1):url.pathname)+"/api/quotes?codes="+encodeURIComponent(symbolsOk.join(",")),"json",fetchImpl);
   const quotes=(Array.isArray(data?.quotes)?data.quotes:[]).filter(q=>known.has(String(q.code))&&validPrice(Number(q.price)))
    .map(q=>({...q,code:String(q.code),price:Number(q.price),time:chinaTimestamp(q.time)||null}));
   if(quotes.length)return {quotes,errors:[],source:"行情代理（腾讯/新浪/东财）"};
  }catch(err){/* anonymous direct sources remain available when private proxy is offline */}
 }

 const codes=symbolsOk.map(exchangePrefix).map((prefix,i)=>prefix+symbolsOk[i]);
 const nowAt=now(),errors=[];
 let main=[];
 try{
  const data=await fetchTimeout("https://qt.gtimg.cn/q="+codes.join(","),"text",fetchImpl);
  main=parseTencent(data,now()).filter(q=>known.has(q.code) && (session(nowAt)!=="open" || quoteState(q,nowAt).fresh));
  if(!main.length)throw Error("无有效或新鲜价格");
 }catch(err){errors.push("腾讯财经："+String(err.message));}
 let missing=symbolsOk.filter(c=>!main.find(q=>q.code===c));
 if(!missing.length)return {quotes:main,errors,source:"腾讯财经"};
 try{
  const secids=missing.map(c=>marketPrefix(c)+c).join(",");
  const url="https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids="+secids+"&fields=f12,f14,f2,f3,f5,f6,f18,f124,f86";
  const backup=parseEastmoney(await fetchEastmoneyJson(url,fetchImpl,6500,{retries:2}),now()).filter(q=>known.has(q.code));
  // Eastmoney often returns f86=0: never mark its quote as fresh or use for automatic matching.
  main=[...main,...backup];missing=symbolsOk.filter(c=>!main.find(q=>q.code===c));
 }catch(err){errors.push("东方财富："+String(err.message));}
 return {quotes:main,errors,source:main.length?"腾讯财经/东方财富":"数据源不可用",missing};
}

export function parseKline(raw){
 const a=raw?.data?.klines;
 if(!Array.isArray(a))return [];
 return a.map(line=>{
  const x=String(line).split(","),[date,o,c,h,l,v,a]=x,bar={date,open:Number(o),close:Number(c),high:Number(h),low:Number(l),volume:Number(v),amount:Number(a)};
  return (String(date).match(/^\d{4}-\d{2}-\d{2}$/)&&[bar.open,bar.close,bar.high,bar.low].every(validPrice))?bar:null;
 }).filter(Boolean);
}

export function parseTrends(raw){
 const a=raw?.data?.trends;
 if(!Array.isArray(a))return [];
 return a.map(line=>{
  const f=String(line).split(","),bar={date:f[0],open:Number(f[1]),price:Number(f[2]),high:Number(f[3]),low:Number(f[4]),volume:Number(f[5]),amount:Number(f[6]),avg:Number(f[7])};
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(bar.date) && validPrice(bar.price) ? bar : null;
 }).filter(Boolean);
}

export function parseTencentMinute(raw,sym){
 const node=raw?.data?.[sym];
 const rawDate=String(node?.data?.date||"").trim(),dm=rawDate.match(/^(\d{4})(\d{2})(\d{2})$/);
 const lines=node?.data?.data;
 if(!dm||!Array.isArray(lines))return {bars:[],prevClose:null};
 const day=dm[1]+"-"+dm[2]+"-"+dm[3];
 const qt=node?.qt?.[sym];
 const prevClose=validPrice(Number(qt?.[4]))?Number(qt[4]):null;
 const dayOpen=validPrice(Number(qt?.[5]))?Number(qt[5]):null;
 const bare=String(sym).replace(/^(?:sh|sz)/,"");
 const isIndex=/^(?:sh000|sz399)/.test(sym);
 const isStar=!isIndex&&/^(?:688|689)/.test(bare);
 const bars=[];
 let prevCumVol=null,prevCumAmt=null,prevPrice=null;
 for(const line of lines){
  const parts=String(line).trim().split(/\s+/);
  const hhmm=parts[0],price=Number(parts[1]),cumVol=Number(parts[2]),cumAmt=Number(parts[3]);
  if(!/^\d{4}$/.test(hhmm)||!validPrice(price))continue;
  const hh=Number(hhmm.slice(0,2)),mm=Number(hhmm.slice(2,4));
  if(hh>23||mm>59)continue;
  const diffVol=Number.isFinite(cumVol)&&cumVol>=0?(prevCumVol===null?cumVol:Math.max(0,cumVol-prevCumVol)):0;
  const diffAmt=Number.isFinite(cumAmt)&&cumAmt>=0?(prevCumAmt===null?cumAmt:Math.max(0,cumAmt-prevCumAmt)):0;
  let avg=null;
  if(!isIndex&&Number.isFinite(cumVol)&&cumVol>0&&Number.isFinite(cumAmt)&&cumAmt>0){
   const c100=cumAmt/(cumVol*100),c1=cumAmt/cumVol;
   const pick=Math.abs(c1/price-1)<Math.abs(c100/price-1)?c1:c100;
   if(validPrice(pick)&&Math.abs(pick/price-1)<=0.35)avg=pick;
  }
  bars.push({
   date:day+" "+hhmm.slice(0,2)+":"+hhmm.slice(2,4),
   open:bars.length===0&&dayOpen?dayOpen:(prevPrice??price),
   price,high:price,low:price,
   volume:isStar?diffVol/100:diffVol,
   amount:diffAmt,
   avg
  });
  if(Number.isFinite(cumVol)&&cumVol>=0)prevCumVol=cumVol;
  if(Number.isFinite(cumAmt)&&cumAmt>=0)prevCumAmt=cumAmt;
  prevPrice=price;
 }
 return {bars,prevClose};
}

export function parseTencentKline(raw,sym,period="day"){
 const node=raw?.data?.[sym];
 const lines=node?.["qfq"+period]||node?.[period];
 if(!Array.isArray(lines))return [];
 const isIndex=/^(?:sh000|sz399)/.test(sym);
 const isStar=!isIndex&&/^(?:688|689)/.test(String(sym).replace(/^(?:sh|sz)/,""));
 return lines.map(row=>{
  if(!Array.isArray(row)||row.length<5)return null;
  const [date,o,c,h,l,v]=row;
  const bar={date:String(date||""),open:Number(o),close:Number(c),high:Number(h),low:Number(l),
   volume:Number.isFinite(Number(v))&&Number(v)>=0?(isStar?Number(v)/100:Number(v)):0,amount:NaN};
  return (/^\d{4}-\d{2}-\d{2}$/.test(bar.date)&&[bar.open,bar.close,bar.high,bar.low].every(validPrice))?bar:null;
 }).filter(Boolean);
}

export async function getHistory(code,period="day",fetchImpl=fetch){
 if(!/^\d{6}$/.test(code))throw Error("无效股票代码");
 const sym=exchangePrefix(code)+code;
 const secid=marketPrefix(code)+code, fields1="f1,f2,f3,f4,f5,f6",fields2="f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
 if(period==="minute"){
  const url="https://push2.eastmoney.com/api/qt/stock/trends2/get?secid="+secid+"&fields1="+fields1+"&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0";
  try{
   const raw=await fetchEastmoneyJson(url,fetchImpl,7500,{retries:2});
   const bars=parseTrends(raw);
   if(bars.length)return {bars,prevClose:validPrice(Number(raw?.data?.prePrice))?Number(raw.data.prePrice):null,source:"东方财富",period};
  }catch{/* fallback to Tencent minute query */}
  const qq=await fetchTimeout("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code="+sym,"json",fetchImpl,8500);
  const parsed=parseTencentMinute(qq,sym);
  if(!parsed.bars.length)throw Error("分时接口未返回有效数据");
  return {bars:parsed.bars,prevClose:parsed.prevClose,source:"腾讯财经",period};
 }
 const klt={day:101,week:102,month:103}[period];
 if(!klt)throw Error("不支持的K线周期");
 const url="https://push2his.eastmoney.com/api/qt/stock/kline/get?secid="+secid+"&fields1="+fields1+"&fields2="+fields2+"&klt="+klt+"&fqt=1&beg=20200101&end=20500101&lmt=140";
 try{
  const raw=await fetchEastmoneyJson(url,fetchImpl,7500,{retries:1});
  const bars=parseKline(raw);
  if(bars.length)return {bars:bars.slice(-120),source:"东方财富",period,adjustment:"前复权"};
 }catch{/* fallback to Tencent fqkline */}
 const qq=await fetchTimeout("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param="+sym+","+period+",,,"+"140,qfq","json",fetchImpl,8500);
 const bars=parseTencentKline(qq,sym,period);
 if(!bars.length)throw Error("K线接口未返回有效数据");
 return {bars:bars.slice(-120),source:"腾讯财经",period,adjustment:"前复权"};
}

/** Parses unadjusted daily OHLCV bars returned by Eastmoney kline API. */
export function parseDaily(payload){
 const lines=payload?.data?.klines;
 if(!Array.isArray(lines))throw Error("Daily OHLCV data absent");
 return lines.map(line=>{
  const [date,open,close,high,low,volume]=String(line).split(",");
  const q={date,open:Number(open),close:Number(close),high:Number(high),low:Number(low),volume:Number(volume)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||![q.open,q.close,q.high,q.low].every(n=>Number.isFinite(n)&&n>0)||
     !Number.isFinite(q.volume)||q.volume<0||q.high+0.01<Math.max(q.open,q.close,q.low)||
     q.low-0.01>Math.min(q.open,q.close))return null;
  return q;
 }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}

/** Fetches unadjusted daily OHLCV bars for an A-share or sh000001 with Tencent fallback. */
export async function getDailyBars(code,{fetchImpl=fetch,timeoutMs=9000,limit=35}={}){
 const sym=code==="sh000001"?"sh000001":
  /^(?:6\d{5}|0\d{5}|3\d{5})$/.test(code)?
   (code.startsWith("6")?"sh":"sz")+code:null;
 const secid=code==="sh000001"?"1.000001":
  sym?(code.startsWith("6")?"1.":"0.")+code:null;
 if(!secid)throw Error("Unsupported A-share "+code);
 const query=new URLSearchParams({secid,fields1:"f1,f2,f3,f4,f5,f6",
  fields2:"f51,f52,f53,f54,f55,f56,f57",klt:"101",fqt:"0",
  beg:"20240101",end:"20500101",lmt:String(Math.min(250,Math.max(35,Number(limit)||35)))});
 try{
  const result=parseDaily(await fetchEastmoneyJson("https://push2his.eastmoney.com/api/qt/stock/kline/get?"+query,fetchImpl,timeoutMs,{retries:1}));
  if(result.length)return result;
 }catch{/* fallback to Tencent unadjusted daily bars */}
 const qq=await fetchTimeout("https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param="+sym+",day,,,"+Math.min(250,Math.max(35,Number(limit)||35)),"json",fetchImpl,timeoutMs);
 const rows=parseTencentKline(qq,sym,"day").filter(q=>q.high+0.01>=Math.max(q.open,q.close,q.low)&&q.low-0.01<=Math.min(q.open,q.close)).sort((a,b)=>a.date.localeCompare(b.date));
 if(!rows.length)throw Error("No valid daily bars "+code);
 return rows;
}
