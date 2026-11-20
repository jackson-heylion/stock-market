import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalFmt,terminalSigned,terminalPercent,terminalUnit,terminalPe,terminalEsc,
 terminalSetScope,terminalSetSort,terminalFollowed,renderTerminalRows,renderMarketTerminal,handleTerminalClick} from '../market-terminal.js';

test('professional screener has screenshot-equivalent core columns and pagination choices',()=>{
 const html=renderMarketTerminal();
 for(const label of ['股票代码','股票名称','当前价','涨跌额','涨跌幅','年初至今','成交量','成交额','换手率','市盈率(TTM)','市净率','市值','操作']){
  assert.ok(html.includes(label),label);
 }
 for(const n of ['30','60','90'])assert.match(html,new RegExp('data-action="mt-size" data-value="'+n+'"'));
 assert.match(html,/沪深一览/);
 assert.match(html,/最近访问/);
 assert.match(html,/我的关注/);
 assert.match(html,/行业板块（东财）/);
 assert.match(html,/data-action="mt-page"/);
});
test('volume uses 100-share lot converted to screenshot-style share units',()=>{
 assert.equal(terminalUnit(20357700),'2035.77万');
 assert.equal(terminalUnit(350000000),'3.50亿');
 assert.equal(terminalUnit(null),'--');
 assert.equal(terminalSigned(3),'+3.00');
 assert.equal(terminalPercent(-1.4),'-1.40%');
 assert.equal(terminalFmt(null),'--');
 assert.equal(terminalPe(-14),'亏损');
 assert.equal(terminalPe(null),'--');
});
test('table HTML escapes text and only allows supported categories/sort keys',()=>{
 assert.equal(terminalEsc('<img src="x">'),'&lt;img src=&quot;x&quot;&gt;');
 assert.equal(terminalSetScope('all'),true);
 assert.equal(terminalSetScope('nonsense'),false);
 assert.equal(terminalSetSort('ytdPct'),true);
 assert.equal(terminalSetSort('__proto__'),false);
 assert.ok(renderTerminalRows().includes('mt-empty'));
});
test('follow action saves separately from seeded paper orders',()=>{
 const following=terminalFollowed();
 assert.equal(following.has('601133'),true);
 let renders=0;
 const rerender=()=>{renders+=1;};
 handleTerminalClick({dataset:{action:'mt-follow',code:'601133'}},{rerender});
 assert.equal(following.has('601133'),false);
 handleTerminalClick({dataset:{action:'mt-follow',code:'601133'}},{rerender});
 assert.equal(following.has('601133'),true);
 assert.equal(renders,2);
});
