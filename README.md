# LuSE Stock Lens

**Live:** https://luse-lens.iamyami.workers.dev

A one-page, client-friendly view of **ZAFFICO (ZFCO)** and **Copperbelt Energy (CECZ)** on the Lusaka Securities Exchange, with live prices from the Mansa Markets API.

- `public/index.html`: the page, including the econometrics. Plain HTML + d3, no build step.
- `worker.js`: a Cloudflare Worker that serves the page, holds the API key, caches responses and collects a daily close.
- `wrangler.toml`: the Worker's settings, storage and schedule.

Opened straight from disk, the page shows the bundled closing prices. Served by the Worker, it goes live.

## How it fits together

```
Browser ──► Cloudflare Worker (worker.js) ──► mansaapi.com (prices, LASI)
            serves public/index.html
            holds MANSA_API_KEY            ──► open.er-api.com (kwacha per US$, daily)
            caches 30 min
            daily cron ──► KV "LENS" (one row per trading day)
```

The key never reaches the browser, and the 30-minute cache keeps usage inside the free tier (100 requests a day).

## Daily collection and the econometric analysis

The free API plan has no price history, so the Worker builds its own. A Cron Trigger runs at 07:00 Lusaka time, Tuesday to Saturday. It saves the previous session's close for ZFCO and CECZ (with volume), the LASI, and kwacha per US$ (from open.er-api.com, free, no key) as one row in the `LENS` KV namespace. Mansa's LuSE figures lag a day, so the row is labelled with the previous weekday. The page reads the rows from `/collected`. That's 3 API requests a day.

The "Econometric analysis" section of the page (the `Econ` script block in `public/index.html`) recomputes on every load:

- **Return attribution.** Splits each price move into known effects (ZAFFICO's rights dilution, the kwacha's move for CEC), the market and a company-specific remainder, then tests the remainder against the stock's own volatility (z-test, t distribution).
- **Dimson beta** to the LASI, corrected for thin trading. Needs 20 matched observations; until then the market share uses beta = 1.
- **ZAFFICO's pull towards the theoretical ex-rights price**, a discrete Ornstein–Uhlenbeck regression with a half-life.
- **CEC's elasticity to the exchange rate**, testing 0 (no link) against 1 (priced as a dollar asset). Needs 20 collected days.
- **Volatility and likely price ranges**, which describe uncertainty, not direction.

Each finding is labelled exact arithmetic, significant, not significant, estimate, or needs more data. Formulas, decision rules and references are in [METHODOLOGY.md](METHODOLOGY.md). Results that need more data fill in by themselves as the rows build up. The Method panel on the page gives the details, and the download button exports the data and results as JSON.

To inspect or reset the collected rows: `npx wrangler kv key get series --binding LENS --remote`.

## Setup (about 15 minutes)

1. **Get an API key.** Request the free Standard key at https://www.mansamarkets.com/developers.
2. **Check the API with your key** before deploying, to confirm the exchange code and response shape:
   ```bash
   curl -H "Authorization: Bearer YOUR_KEY" https://mansaapi.com/api/v1/markets/exchanges/LuSE/stocks/ZFCO
   curl -H "Authorization: Bearer YOUR_KEY" "https://mansaapi.com/api/v1/markets/exchanges/LuSE/stocks/ZFCO/history?range=1Y"
   curl -H "Authorization: Bearer YOUR_KEY" https://mansaapi.com/api/v1/markets/exchanges/LuSE/stocks
   curl -H "Authorization: Bearer YOUR_KEY" https://mansaapi.com/api/v1/markets/exchanges/LuSE
   ```
   - The last call is the exchange overview. The page reads the LASI value from it first and falls back to `/indices/LASI` if that fails. If the value is under a field name it doesn't know, add it to the `pick()` list in `liveIndex()`.
   - If `LuSE` returns 404, try `LUSE` and set the Worker's `EXCHANGE` variable to match.
   - The third call lists LuSE tickers. Check that the index code is `LASI`.
   - The page reads common field names (`price`/`close`, `change_pct`/`changePercentage`, `date`). If yours differ, add them to the `pick()` lists in `public/index.html`.
3. **Deploy the Worker** with Wrangler, from this folder (`wrangler.toml` already sets `ALLOWED_ORIGINS`, `EXCHANGE`, the KV namespace and the daily schedule; on a new account, create the namespace with `npx wrangler kv namespace create LENS` and put its id in `wrangler.toml`):
   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put MANSA_API_KEY   # paste your key when asked
   ```
   Don't drag this folder into the dashboard's upload screen: it only takes static files and rejects `worker.js`.
4. **Open it.** `wrangler deploy` prints the URL, e.g. `https://luse-lens.<you>.workers.dev`. The same command publishes the page in `public/`, so later changes to the page or the Worker are one `npx wrangler deploy`.
   To also host the page elsewhere (e.g. iamyami.com), upload `public/index.html` there and make sure that site is in `ALLOWED_ORIGINS`.

The status pill at the top says what is live:
- **Live prices and history**: quotes and full history from the API.
- **Live prices · history from collected closing prices**: quotes are live, but the history endpoint isn't on your plan (daily history is the Professional tier, $50/month).
- **Live feed unavailable**: the proxy or API failed, so the page shows the bundled data. Open the browser console to see why.

## Things to know

- **Licence:** the free Standard key is for personal use. A demo you share is fine to discuss, but using the data in a product Chuuma runs would need a commercial plan (Professional, $50/month).
- **CORS:** the page never calls mansaapi.com directly; only the Worker does. Calling the API directly from the browser would expose the key.
- **Thin trading:** some LuSE stocks don't trade every day, so "latest price" can be several days old. The page shows the as-of date on every tile.

## Data sources for the bundled figures

| Data | Source |
|---|---|
| ZFCO, CECZ, LASI dated closes | LuSE Daily Stock Data and June 2026 market update; Mansa Markets daily LuSE wraps; AfricanFinancials |
| ZAFFICO rights issue (1-for-1 at K2.53, ex-rights 22 Jul 2026, offer extended to 18 Sep) | LuSE SENS 15 Jul, 17 Jul, 26 Aug 2026; IDC launch statement |
| ZAFFICO 2025 EPS K1.29 (2024: K1.85), revenue targets | ZAFFICO 2025 abridged results; IDC |
| CECZ EPS K1.58, dividend yield 6.77%, 52-week K14.00–K23.89 | Chuuma CECZ page, 14 Oct 2026 |
| CECZ H1 2026 results (revenue US$380.3m, adj. EBITDA US$110.5m, PAT US$61.6m, no dividend) | CEC Plc half-year results, LuSE SENS 28 Aug 2026 |
| Kwacha per US$: 22.19 (31 Dec 2025), 19.33 (9 Oct 2026) | EODHD closes, reported by The Rio Times |
| CECZ 1 Jan 2026 price K19.30 | Derived: K16.86 on 8 Jun 2026 at −12.64% YTD (AfricanFinancials) |

Not investment advice.
