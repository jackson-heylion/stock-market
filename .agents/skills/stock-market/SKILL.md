---
name: stock-market
description: Manage this repository's A-share paper-trading MVP, watchlist, historical snapshots, virtual portfolio and five explainable pre-breakout models.
---
# Stock Market · paper trading skill

## Scope
This repository contains a **static, local-only** A-share paper-trading interface on GitHub Pages. Never submit real broker orders, claim live data, generate fictional intraday candles or fabricate an order filled during a trading suspension. The seed is an educational historical counterfactual, not a claim that real market orders were executed at the close.

## Architecture
- `seed.js`: curated quotes **as of 2026-11-19 15:00 CST**, evidence links, watchlist, five strategy definitions and initial evidence statuses.
- `engine.js`: deterministic 100-share lot sizing, fee accounting, T+1 conservative lock, positions, valuation, portfolio, state replay validation.
- `app.js`: UI state, localStorage persistence, user-marked prices, evidence checklists, export/import.
- `index.html` and `style.css`: dependency-free client-only site.
- `.github/workflows/pages.yml`: test and deploy from `main` via GitHub Actions.

## Models
- `M1` 中船特气: price/volume industry supply-demand squeeze.
- `M2` 利通电子: orders, earnings, volume trend.
- `M3` 锋龙股份: announced change of control and buyer quality.
- `M4` 新华传媒: announced material asset restructuring.
- `M5` 华电辽能: policy event and market sentiment breadth.
Each model has **four explicit human-verified checks**, encoded 1=confirmed, 0=unverified, -1=contradicted; do NOT interpret the confirmed fraction as a calibrated success probability.

## Commands and acceptance
Run `npm test` and `npm run check`. Test budget rounding, commission/stamp/transfer fees, no negative cash, T+1, halt nonexecution, no duplicate reload and import replay protection before changes to trading logic.

## Updating prices and research
1. Verify the exchange, symbol and trading date. Add authoritative source link and explicit timestamp; never silently overwrite the 11/19 historical baseline.
2. For current P&L, use the UI's manual price update, labeled *unverified*. For productizing live quotes later, add a timestamped legal licensed API and server-side keys, never hard-code credentials on Pages.
3. Do not seed fake historical purchases for a suspended stock. Adjust only the watchlist/halt status when a verified resumption notice is available.
4. Each simulated BUY uses 100-share lots with a fixed ¥100,000 maximum per symbol. Keep fee surplus in cash. Each SELL respects the conservative T+1 check.
5. Check for data revisions, share split adjustments, order timestamps, fees and source provenance.

## Workflow
Design -> create/adjust deterministic unit tests -> implement -> run both commands -> review the accounting invariants and XSS boundaries -> commit -> inspect Pages deployment. Never call a local saved browser value a shared account: all state stays in that browser's localStorage. Warn that GitHub Pages may not be available for a private repo on GitHub Free.

## Quote adapters and charts
- `market.js`: browser-side anonymous Tencent quotes, Eastmoney quote fallback and Eastmoney minute / adjusted daily-weekly-monthly candles. Never execute Tencent/Sina JS blobs; decode text and parse numbers only.
- `charts.js`: render SVG from validated minute bars or OHLCV candles; no fabricated curves and moving averages are computed solely from returned bars.
- `server/quote-proxy.mjs`: optional Node relay: Tencent→Sina (Referer)→Eastmoney; Pages cannot use Sina directly because Sina response lacks CORS.
- Realtime quotes are **ephemeral view state**, not historical ledger transactions. Keep `state.trades` and seed order prices unchanged. Show source/quote time/staleness; do not claim guaranteed exchange live prices.
- Every chart query must return real points; errors show an empty state instead of synthetic prices. `npm test` must pass for parse, fallback and candle rendering.
- To smoke-test current anonymous public hosts with real external network, run `.github/workflows/verify-quotes.yml`. This validates a GitHub runner, not domestic latency.

## Market dashboard and A-share ranking center
- `market-center.js`: exchange-qualified SSE/SZSE/ChiNext/STAR50/CSI300 index quotes, A-share ranking and industry board parsers, data-backed index trend/Kline fetching. Explicit scope and sort allowlists; never interpolate user-provided `fs` or index `secid` into provider URLs.
- `app.js`: `market` and `quotes` routes are read-only research. They must never mutate `state.trades` or allow trading arbitrary market-center symbols; only the curated eight `SECURITIES` pass through the trade engine.
- `tests/market-center.test.js`: validate index identity (Shanghai 000001 != Shenzhen stock 000001), sector code isolation, invalid price drops, ranking scope/sort and index history paths. Run `npm test && npm run check` before deployments.
- Freshness: identify provider and last request time separately, refuse to invent quote timestamps. A ranking list contains only the requested top N, not the entire equity universe; `data.total` is coverage, not advance/decline counts.
- On API failure show an explicit empty/stale state. Avoid synthetic market breadth, historical candles and fabricated live trading conditions.

## Dense exchange quote terminal
- `market-terminal.js`: light professional grid table, 30/60/90 server-side pages, price/ytd/valuation columns, categories, Eastmoney sectors, recent visits and independent `localStorage` follows. The **simulated ledger remains untouched**.
- `market-center.js` extracts `f4` price change, `f25` YTD, `f8` turnover rate, `f9` TTM P/E, `f23` P/B, `f20` market capitalization. Preserve nulls, do not convert missing fields to zero.
- Guard any sort key and board code through explicit allowlists. Never sort only the visible page when the user requests a market-wide sort. Pagination is vendor-side, 30/60/90 requests.
- `f5` is lots, convert to 100-share lots for the displayed share count. Quotes remain unlicensed and may be delayed.
- `market-terminal.js` cannot create trades for unseeded stocks; Follow is independent of holdings.

## Unified color theme
- Global mode defaults to `dark`; `theme.js` reads/writes `stock-market-theme-v1` separately from paper ledger keys.
- `theme.css` comes after `style.css`; it overrides all routes, dialogs, table, market center, and chart legends with consistent dark/light tokens.
- Market center must not hard-code a white-only layout. Its full table uses `--mt-*` semantic tokens, including up/down A-share colors and zebra backgrounds.
- Ensure `aria-pressed`, icon/label and `meta[name="theme-color"]` update together; test both states and persistence. No theme logic may mutate `state.trades`, watchlist, holdings or market quotes.
- Chart SVG grid, tick labels and moving-average lines reference CSS custom properties to remain readable in either mode.

## Real-time market radar data integrity
- `market-center.js`: allowlists `speed` (`f22`) as a provider-native sortable metric. Never substitute locally sampled quote differences without naming the method separately.
- `market-radar.js`: sector `f3/f6`, 7x24 fast news headlines (nonempty `req_trace` is required to avoid 200/null), and 22 mapped anomaly codes from Eastmoney `getAllStockChanges`. All source data is untrusted; parse and validate, never execute remote JavaScript.
- `radar-view.js`: treemap area from valid sector turnover (min-size for readability), red/green by provider `f3`; headline word cloud counts literal tokens/lexicon concepts only if they occurred in actual published headlines within 2 hours. No synthetic words, alleged crowd sentiment, or fake news.
- Source event records only specify HHMMSS, not a trade date. Preserve this uncertainty. Absent or failed feeds show an explicit status, retaining prior valid data without pretending to be live.
- Refresh visible market radar on a 15-second anomaly / 45-second sector / 60-second news TTL; view-only, never write market feed records to the simulated ledger.
- `tests/radar.test.js` and the GitHub Actions source probe are required regression gates before publishing to Pages.

## Radar reliability repair: browser delivery is a separate acceptance gate
- Heatmap `heatmapHtml()`: top16 adaptive tile chart + full36 readable list. `radar.css` uses `container-type:size` and explicit size thresholds, so no label is exposed when too small to be legible. Tiles preserve title and click action even when only an index is shown. The matching list must include every sampled sector.
- Browser network can block a provider hostname despite successful GitHub Actions CORS probes. `getLiveNews()` must use the same-origin `./data/fast-news.json` after a bounded direct-request failure. The snapshot is **real source data**, generated by `scripts/build_news_snapshot.py` during GitHub Pages build, never seeded synthetic headlines.
- `.github/workflows/pages.yml` schedules best-effort updates every 10 minutes during Beijing market-related weekday hours. Do not promise exact triggers, low-latency feed or source-level license. Maintain distinct `fetchedAt` vs original `showTime`; reject bad/expired snapshots, preserve last-success state, label stale state.
- Accept only after `npm test && npm run check`, Pages deployment green, and an **actual HTTP request to deployed** `/stock-market/data/fast-news.json` confirms 200 with a non-empty, time-stamped title array. CI tool-network success alone is insufficient to claim browser usability.
