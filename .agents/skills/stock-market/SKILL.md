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
