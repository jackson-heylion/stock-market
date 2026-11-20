// Unofficial public market-data adapters; no credentials. Return provenance and quote time.

// A valid HTTP response does not guarantee real-time exchange data.

export const POLL_MS=3000;

export function marketPrefix(code){return String(code).startsWith("6")?"1.":"0."}

export function exchangePrefix(code){return String(code).startsWith("6")?"sh":"sz"}

export function validPrice(n){return Number.isFinite(n)&&n>0&&n<1000000}

export function chinaTimestamp(raw){
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

export async function getQuotes(symbols,{fetchImpl=fetch,now=()=>Date.now()}={}){
 const symbolsOk=symbols.filter(x=>/^\d{6}$/.test(x)),known=new Set(symbolsOk);
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
  const backup=parseEastmoney(await fetchTimeout(url,"json",fetchImpl),now()).filter(q=>known.has(q.code));
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

export async function getHistory(code,period="day",fetchImpl=fetch){
 if(!/^\d{6}$/.test(code))throw Error("无效股票代码");
 const secid=marketPrefix(code)+code, fields1="f1,f2,f3,f4,f5,f6",fields2="f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
 if(period==="minute"){
  const url="https://push2.eastmoney.com/api/qt/stock/trends2/get?secid="+secid+"&fields1="+fields1+"&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0";
  const raw=await fetchTimeout(url,"json",fetchImpl,9000);
  const bars=parseTrends(raw);
  if(!bars.length)throw Error("分时接口未返回有效数据");
  return {bars,prevClose:Number(raw?.data?.prePrice)||null,source:"东方财富",period};
 }
 const klt={day:101,week:102,month:103}[period];
 if(!klt)throw Error("不支持的K线周期");
 const url="https://push2his.eastmoney.com/api/qt/stock/kline/get?secid="+secid+"&fields1="+fields1+"&fields2="+fields2+"&klt="+klt+"&fqt=1&beg=20200101&end=20500101&lmt=140";
 const raw=await fetchTimeout(url,"json",fetchImpl,9000);
 const bars=parseKline(raw);
 if(!bars.length)throw Error("K线接口未返回有效数据");
 return {bars,source:"东方财富",period,adjustment:"前复权"};
}
