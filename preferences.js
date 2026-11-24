// Browser-only preferences. They do not alter GitHub Actions bot account settings.
export const PREF_KEY='stock-market-ui-settings-v1';
export const DEFAULT_PREFS=Object.freeze({
 autoQuotes:true,quoteInterval:3000,defaultBudget:100000,
 confirmTrades:true,tablePageSize:30,defaultChartPeriod:'minute',showRiskHints:true,
 autoBotRefresh:true,autoOpeningHold:true
});
export function normalizePrefs(raw){
 const x=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
 return {
 autoQuotes:typeof x.autoQuotes==='boolean'?x.autoQuotes:true,
 quoteInterval:[3000,10000,30000].includes(Number(x.quoteInterval))?Number(x.quoteInterval):3000,
 defaultBudget:[50000,100000,150000,200000].includes(Number(x.defaultBudget))?Number(x.defaultBudget):100000,
 confirmTrades:typeof x.confirmTrades==='boolean'?x.confirmTrades:true,
 tablePageSize:[30,60,90].includes(Number(x.tablePageSize))?Number(x.tablePageSize):30,
 defaultChartPeriod:['minute','day','week','month'].includes(x.defaultChartPeriod)?x.defaultChartPeriod:'minute',
 showRiskHints:typeof x.showRiskHints==='boolean'?x.showRiskHints:true,
 autoBotRefresh:typeof x.autoBotRefresh==='boolean'?x.autoBotRefresh:true,
 autoOpeningHold:typeof x.autoOpeningHold==='boolean'?x.autoOpeningHold:true
 };
}
export function readPrefs(store=typeof localStorage==='undefined'?null:localStorage){
 try{return normalizePrefs(JSON.parse(store?.getItem(PREF_KEY)||'null'));}catch{return {...DEFAULT_PREFS};}
}
export function savePrefs(value,store=typeof localStorage==='undefined'?null:localStorage){
 const next=normalizePrefs(value);
 try{store?.setItem(PREF_KEY,JSON.stringify(next));return next;}
 catch{return null;}
}
export function resetPrefs(store=typeof localStorage==='undefined'?null:localStorage){
 const next={...DEFAULT_PREFS};
 try{store?.setItem(PREF_KEY,JSON.stringify(next));return next;}
 catch{return null;}
}
