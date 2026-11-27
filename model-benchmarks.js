// Historical research examples only; never feed these into live evidence, candidate selection or orders.
export const MODEL_BENCHMARKS = {
  "short": [
    {
      "id": "S1",
      "code": "300059",
      "name": "东方财富",
      "period": "2024-09-27",
      "fact": "放量上攻，成交额约282亿元，创当时上市以来新高。",
      "verify": "完整前20日最高价、前5日均量、行业强度与盘中承接；涨停时不假设可买。",
      "sources": [
        "https://epaper.cs.com.cn/zgzqb/html/2024-09/28/nw.D110000zgzqb_20240928_1-A03.htm"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "S2",
      "code": "002085",
      "name": "万丰奥威",
      "period": "2024-04-11 至 2024-04-24",
      "fact": "低空经济强势阶段出现明显调整，4月24日板块再度走强；适合复查回踩与修复是否成立。",
      "verify": "前5日涨幅≥8%、价格处于MA10至MA5×1.04、量比≤0.8及承接；4月11日跌停不是合格低吸点。",
      "sources": [
        "https://www.stcn.com/article/detail/1173019.html",
        "https://www.stcn.com/article/detail/1186689.html"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "S3",
      "code": "601162",
      "name": "天风证券",
      "period": "2024-09-24",
      "fact": "金融政策催化下券商板块扩散，当日天风证券首板。",
      "verify": "前一完整日非连板、盘中涨幅0.8%–8%、行业成交额前3、量能和承接；封板后不可按本规则追买。",
      "sources": [
        "https://stock.cngold.org/c/2024-09-24/c9507765.html",
        "https://stcn.com/article/detail/1330168.html"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "S4",
      "code": "000158",
      "name": "常山北明",
      "period": "2024-09-24 至 2024-09-25",
      "fact": "前日下跌7.19%，次日上涨10.02%，提供分歧后修复的历史观察窗口。",
      "verify": "核对重新突破前日最高价、行业强度、量能及承接；收盘涨幅不证明盘中信号或可成交。",
      "sources": [
        "https://www.stcn.com/article/detail/1354653.html"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "S5",
      "code": "603580",
      "name": "艾艾精工",
      "period": "2024-03-05 至 2024-03-21",
      "fact": "连续13个交易日涨停，期间存在较高换手；次日大幅跳水，亦是接力失效的风险样本。",
      "verify": "至少2个已完成交易日连板、行业成交额前3、盘中涨幅0.8%–8%、承接；非封板且可成交才可考虑。",
      "sources": [
        "https://stcn.com/article/detail/1154398.html",
        "https://www.stcn.com/article/detail/1150247.html"
      ],
      "status": "待完整历史复核"
    }
  ],
  "wave": [
    {
      "id": "W1",
      "code": "300308",
      "name": "中际旭创",
      "period": "2024-04-22",
      "fact": "2023年归母净利润同比增长77.58%，高端光模块受AI需求拉动。",
      "verify": "AI业务、成长、当时估值，价格>MA20且MA20≥MA60；财报公布前不得使用该财报。",
      "sources": [
        "https://epaper.stcn.com/con/202404/22/content_2619424.html",
        "https://paper.cnstock.com/html/2024-04/22/content_1902056.htm"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "W2",
      "code": "603993",
      "name": "洛阳钼业",
      "period": "2025-03-21",
      "fact": "2024年产铜量同比增长55%，归母净利润增长64.03%；可研究供需及产能兑现。",
      "verify": "核对当时铜价与行业周期是否复苏（扩产本身不等同周期复苏）、估值、价格>MA20且MA20≥MA60。",
      "sources": [
        "https://www.cmoc.com/html/2025/News_0321/318.html"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "W3",
      "code": "002371",
      "name": "北方华创",
      "period": "2024-10-29",
      "fact": "三季报后的半导体设备需求复苏及业绩增长，是景气与公司成长结合的研究窗口。",
      "verify": "成长、产业景气、估值，价格>MA60且MA60≥MA120；研究观点不是景气已兑现的证明。",
      "sources": [
        "https://stock.finance.sina.com.cn/stock/go.php/vReport_Show/kind/company/rptid/783741690058/index.phtml"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "W4",
      "code": "300750",
      "name": "宁德时代",
      "period": "2024-03-11",
      "fact": "经历较长调整后单日上涨14.46%，可研究成长股的趋势修复，而非追逐单日涨幅。",
      "verify": "核对当时成长及估值，价格>MA20且≤MA60×1.10；涨幅过大可能已超出模型区间。",
      "sources": [
        "https://www.yicai.com/news/102023685.html",
        "https://m.21jingji.com/article/20240312/6450d47a7c70226af32322274b0a4c3f_zaker.html"
      ],
      "status": "待完整历史复核"
    },
    {
      "id": "W5",
      "code": "002594",
      "name": "比亚迪",
      "period": "2024-10-30",
      "fact": "前三季度归母净利润同比增18.12%，9月新能源车销量创当时公司月度纪录；研究产业龙头成长。",
      "verify": "龙头地位、行业周期、成长、估值、价格>MA60且MA60≥MA120、60日相对沪指强度≥10个百分点。",
      "sources": [
        "https://www.stcn.com/article/detail/1390458.html",
        "https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=10569617&stockid=002594"
      ],
      "status": "待完整历史复核"
    }
  ]
};
export function benchmarksFor(type){return MODEL_BENCHMARKS[type]||[];}
