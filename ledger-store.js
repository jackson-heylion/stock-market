import {STORAGE_KEY,initialState,migrateCapital,validateState,cloneState} from './engine.js';
export const LEDGER_LOCK='stock-market-opening-hold-v1';
// All browser ledger writers share the existing opening-risk lock, including imports and initialization.
export async function editLedger(update,{storage=globalThis.localStorage,locks=globalThis.navigator?.locks,ifAvailable=false}={}){
 if(!locks?.request)return {ok:false,error:'浏览器不支持安全账本锁，写入已暂停'};
 try{return await locks.request(LEDGER_LOCK,{ifAvailable},lock=>{
  if(!lock)return {ok:false,error:'账本正被其他页面修改，请稍后重试'};
  const raw=storage.getItem(STORAGE_KEY);
  const current=raw===null?initialState():migrateCapital(JSON.parse(raw));
  if(!current)return {ok:false,error:'本地账本校验失败，禁止覆盖'};
  const next=cloneState(current),result=update(next,current)||{};
  if(result.ok===false)return result;
  const output=result.state??next;
  if(!validateState(output))return {ok:false,error:'账本校验失败，未保存'};
  if(storage.getItem(STORAGE_KEY)!==raw)return {ok:false,error:'账本发生变化，未保存'};
  if(raw===null||JSON.stringify(output)!==raw)storage.setItem(STORAGE_KEY,JSON.stringify(output));
  return {...result,ok:true,state:output};
 });}catch(err){return {ok:false,error:'账本写入失败：'+String(err.message||err)};}
}
