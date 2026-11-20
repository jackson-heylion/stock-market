import {createServer} from 'node:http';
import {parseTencent,parseSina,parseEastmoney,quoteState,session} from '../market.js';
const allowed=new Set(['601133','300829','603931','600156','000635','600520','301348','002579']);
const port=Number(process.env.PORT||8787);
const timeout=Number(process.env.QUOTE_TIMEOUT_MS||5000);
const allowedOrigins=new Set(['https://jackson-heylion.github.io','http://localhost:8000','http://127.0.0.1:8000']);
const exchange=c=>c.startsWith('6')?'sh'+c:'sz'+c;
const secid=c=>(c.startsWith('6')?'1.':'0.')+c;
async function textResponse(url,options={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(timeout),cache:'no-store'});
 if(!r.ok)throw Error('Upstream HTTP '+r.status);
 return new TextDecoder('gb18030').decode(await r.arrayBuffer());
}
async function jsonResponse(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(timeout),cache:'no-store'});
 if(!r.ok)throw Error('Upstream HTTP '+r.status);
 return r.json();
}
function acceptable(q,now){
 // In a live session reject stale or unverified provider time. Closed/auction values are reference only.
 return session(now)!=='open'||quoteState(q,now).fresh;
}
async function collect(codes){
 const now=Date.now(),quotes=new Map(),errors=[];
 async function add(items){
  for(const q of items)if(codes.includes(q.code)&&q.price>0&&acceptable(q,now)&&!quotes.has(q.code))quotes.set(q.code,q);
 }
 try{await add(parseTencent(await textResponse('https://qt.gtimg.cn/q='+codes.map(exchange).join(',')),Date.now()));}
 catch(err){errors.push('腾讯: '+err.message);}
 let missing=codes.filter(c=>!quotes.has(c));
 if(missing.length){
  try{await add(parseSina(await textResponse('https://hq.sinajs.cn/list='+missing.map(exchange).join(','),{headers:{Referer:'https://finance.sina.com.cn/'}}),Date.now()));}
  catch(err){errors.push('新浪: '+err.message);}
 }
 missing=codes.filter(c=>!quotes.has(c));
 if(missing.length){
  try{await add(parseEastmoney(await jsonResponse('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids='+missing.map(secid).join(',')+'&fields=f12,f14,f2,f3,f5,f6,f18,f124,f86'),Date.now()));}
  catch(err){errors.push('东财: '+err.message);}
 }
 return {quotes:[...quotes.values()],errors,receivedAt:Date.now()};
}
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const origin=req.headers.origin;
  if(origin&&allowedOrigins.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'Method Not Allowed'}));return;}
  if(url.pathname==='/api/health'){res.end(JSON.stringify({ok:true}));return;}
  if(url.pathname!=='/api/quotes'){res.writeHead(404);res.end(JSON.stringify({error:'Not Found'}));return;}
  const codes=[...new Set((url.searchParams.get('codes')||'').split(',').filter(x=>allowed.has(x)))];
  if(!codes.length){res.writeHead(400);res.end(JSON.stringify({error:'No allowed stock codes'}));return;}
  res.end(JSON.stringify(await collect(codes)));
 }catch(err){res.writeHead(502);res.end(JSON.stringify({error:String(err.message)}));}
}).listen(port,'0.0.0.0',()=>console.log('Quote relay listening on '+port));
