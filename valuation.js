import {shDate} from './engine.js';
import {session} from './market.js';
const valid=n=>Number.isFinite(n)&&n>0;
export function verifiedQuote(q,now=Date.now()){
 if(!q||!valid(q.price)||!Number.isFinite(q.time)||q.time>now)return false;
 return shDate(new Date(q.time))===shDate(new Date(now))&&(session(now)!=='open'||now-q.time<=15000);
}
export function referencePrice(saved,q,now=Date.now()){
 const validQ=q&&valid(q.price)&&Number.isFinite(q.time)&&q.time<=now;
 const day=validQ?shDate(new Date(q.time)):null;
 // A user-marked quote is a deliberate reference override, until a demonstrably newer timestamp.
 if(saved?.source?.startsWith('用户手动')&&(!validQ||day<saved.date||day===saved.date&&(!Number.isFinite(saved.markedAt)||q.time<=saved.markedAt)))return saved;
 if(validQ&&(!saved||day>=saved.date))return {price:q.price,date:day,source:q.source||'公开行情',quoteTime:q.time};
 return saved??null;
}
