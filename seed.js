// Fixed historical snapshots. Never imply these are live quotes.
export const SNAPSHOT_DATE = '2026-11-19';
export const INITIAL_CASH = 800_000;
export const BUDGET_PER_STOCK = 100_000;
export const FEE_RULES = Object.freeze({commissionRate: 0.00025, minCommission: 5, transferRate: 0.00001, sellStampRate: 0.0005});
export const SECURITIES = Object.freeze([
  {code:'601133',name:'柏诚股份',market:'SH',close:17.33,pct:6.06,halted:false,models:['M2'],tags:['半导体工程','订单增长'],note:'在手订单增长较快；利润兑现待跟踪',source:'https://www.laocaifu.com/stock/601133/'},
  {code:'300829',name:'金丹科技',market:'SZ',close:27.00,pct:-12.65,halted:false,models:['M1'],tags:['乳酸涨价','高波动'],note:'涨价逻辑存在，但11月19日大幅回撤',source:'https://stock.stockstar.com/RB2026111900023162.shtml'},
  {code:'603931',name:'格林达',market:'SH',close:29.15,pct:10.00,halted:false,models:['M1','M5'],tags:['电子化学品','先进封装'],note:'3天2板，反包后关注换手承接',source:'https://zhishi.ltd/replay?date=2026-11-19&tab=limitup'},
  {code:'600156',name:'华升股份',market:'SH',close:8.90,pct:10.01,halted:false,models:['M4'],tags:['重大资产重组','算力'],note:'二连板；重组存在不确定性',source:'https://cn.investing.com/equities/huasheng-historical-data'},
  {code:'000635',name:'英力特',market:'SZ',close:null,pct:null,halted:true,referencePrice:11.00,referenceDate:'2026-11-12',models:['M3','M4'],tags:['控制权变更','停牌'],note:'11月19日停牌，无当日收盘价；11元仅为停牌前参考价',source:'https://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=12715185&stockid=000635'},
  {code:'600520',name:'三佳科技',market:'SH',close:22.17,pct:10.02,halted:false,models:['M5'],tags:['先进封装','首板'],note:'封装题材首板，注意次日溢价',source:'https://www.dapanbao.com/review/2026-11-19/'},
  {code:'301348',name:'蓝箭电子',market:'SZ',close:21.66,pct:20.00,halted:false,models:['M5'],tags:['半导体封测','20cm首板'],note:'高波动，区分冲高与资金持续承接',source:'https://data.cfi.cn/data_ndkA0A1934A1935A60.html'},
  {code:'002579',name:'中京电子',market:'SZ',close:12.17,pct:10.04,halted:false,models:['M2','M5'],tags:['PCB','首板'],note:'高换手首板，需观察资金接力',source:'https://data.cfi.cn/data_ndkA0A1934A1935A60.html'}
]);
export const MODEL_DEFINITIONS = Object.freeze([
  {id:'M1',name:'中船特气',type:'供需涨价周期',description:'需求抬升与供给约束导致产品持续涨价，盈利向上修正。',checks:['核心产品价格持续上涨且有来源','产能、配额或供需缺口获证实','盈利改善有报表支撑','底部量价出现有效突破'],risk:'涨价可能已经兑现于股价，需核验利润与估值。'},
  {id:'M2',name:'利通电子',type:'业绩订单共振',description:'新业务或订单先行增长，盈利兑现与资金趋势形成共振。',checks:['订单或核心业务增速有公开数据','盈利质量及现金流改善','价格突破整理平台','成交量与相对强弱同步确认'],risk:'订单不等于利润，避免追逐单日异动。'},
  {id:'M3',name:'锋龙股份',type:'控制权重估',description:'正式公告控制权变化，市场重新评估产业方注入和后续发展。',checks:['正式控制权转让公告','收购方产业实力已核验','交易条款与审批障碍可评估','公告后买盘承接有效'],risk:'不能用K线预测未公告重组；停牌股票不可成交。'},
  {id:'M4',name:'新华传媒',type:'资产重组重估',description:'重大资产交易改变盈利结构，引发估值锚变化与情绪加速。',checks:['重大资产交易已正式披露','标的资产与业务质量可核验','审批进度和交易估值合理','公告后量价与接力结构健康'],risk:'重组失败、估值过高、一字板无法成交。'},
  {id:'M5',name:'华电辽能',type:'政策题材与情绪周期',description:'政策催化驱动板块扩散，观察首板梯队、分歧修复及退潮。',checks:['政策或产业催化来源可靠','同题材至少三股显著呼应','连板梯队或首板扩散','分歧后的换手承接确认'],risk:'情绪退潮可快速反转；连板不是低位信号。'}
]);
// Human-reviewed, time-stamped checklist statuses: 1 confirmed, 0 unknown, -1 contradicted.
export const SEED_SIGNALS = {
 '601133':{M2:[1,0,0,0]},'300829':{M1:[1,1,0,-1]},'603931':{M1:[0,0,0,0],M5:[1,1,1,0]},
 '600156':{M4:[1,0,0,1]},'000635':{M3:[1,1,0,0],M4:[1,0,0,0]},'600520':{M5:[1,1,1,0]},
 '301348':{M5:[1,1,1,0]},'002579':{M2:[0,0,0,1],M5:[1,1,1,0]}
};
