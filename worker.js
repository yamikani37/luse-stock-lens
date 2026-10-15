// Cloudflare Worker: a small proxy between the dashboard page and the Mansa Markets API.
// - Keeps your API key secret (stored as a Worker secret, never sent to the browser).
// - Only forwards the few routes the page needs, for the tickers you allow.
// - Caches each answer for 30 minutes (Mansa refreshes LuSE every 30 minutes),
//   which keeps a busy page well inside the free plan's 100 requests a day.
//
// Settings (Cloudflare dashboard → Worker → Settings → Variables):
//   MANSA_API_KEY    secret, your key from mansamarkets.com/developers
//   ALLOWED_ORIGINS  e.g. "https://iamyami.com,https://yamikani37.github.io"
//   EXCHANGE         optional, defaults to "LuSE" (check the code the API expects)
//
// Daily collection: a Cron Trigger (see wrangler.toml) saves one row of closes per trading day
// to the LENS KV namespace, because the free API plan has no history endpoint. The page reads
// the rows from /collected and uses them for the econometric analysis.

const UPSTREAM = "https://mansaapi.com/api/v1/markets";
const TICKERS = new Set(["ZFCO", "CECZ", "CCAF", "ZNCO", "SCBL", "ATEL"]);
const INDICES = new Set(["LASI"]);
const RANGES = new Set(["1M", "3M", "6M", "1Y", "YTD", "ALL"]);
const CACHE_SECONDS = 1800;
const COLLECT = ["ZFCO", "CECZ"];
const FX_URL = "https://open.er-api.com/v6/latest/USD"; // free, no key; daily ZMW per USD

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "null",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, cors);

    const url = new URL(request.url);
    if (url.pathname === "/collected") {
      const rows = (env.LENS && (await env.LENS.get("series", "json"))) || [];
      return json(rows, 200, { ...cors, "Cache-Control": `public, max-age=${CACHE_SECONDS}` });
    }
    const upstreamPath = route(url, env.EXCHANGE || "LuSE");
    if (!upstreamPath) return json({ error: "not found" }, 404, cors);

    // Serve from cache when we can.
    const cache = caches.default;
    const cacheKey = new Request(UPSTREAM + upstreamPath, { method: "GET" });
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(UPSTREAM + upstreamPath, {
        headers: { Authorization: `Bearer ${env.MANSA_API_KEY}`, Accept: "application/json" },
      });
      const body = await up.text();
      res = new Response(body, {
        status: up.status,
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      });
      // Also cache "not on your plan" (403) and "not found" (404), so they don't use up the daily quota.
      if (up.ok || up.status === 403 || up.status === 404) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(collect(env));
  },
};

// One row per Lusaka trading day:
// { d, ZFCO: [price, volume], CECZ: [price, volume], LASI: value, FX: ZMW per USD }
// Fields that fail to load are left out, so one bad call doesn't lose the whole day.
async function collect(env) {
  const ex = env.EXCHANGE || "LuSE";
  const get = async (url, auth) => {
    const r = await fetch(url, { headers: auth ? { Authorization: `Bearer ${env.MANSA_API_KEY}`, Accept: "application/json" } : {} });
    if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
    return r.json();
  };
  // Runs before the market opens, when the API still shows the previous session's close
  // (Mansa's LuSE figures lag a day), so label the row with the previous weekday in Lusaka (UTC+2, no DST).
  const t = new Date(Date.now() + 2 * 3600e3);
  do t.setUTCDate(t.getUTCDate() - 1); while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  const d = t.toISOString().slice(0, 10);
  const row = { d };
  const jobs = [
    ...COLLECT.map((t) => get(`${UPSTREAM}/exchanges/${ex}/stocks/${t}`, true).then((j) => {
      if (Number.isFinite(j.data?.price)) row[t] = [j.data.price, j.data.volume ?? null];
    })),
    get(`${UPSTREAM}/exchanges/${ex}`, true).then((j) => {
      if (Number.isFinite(j.data?.index_value)) row.LASI = j.data.index_value;
    }),
    get(FX_URL, false).then((j) => {
      if (Number.isFinite(j.rates?.ZMW)) row.FX = j.rates.ZMW;
    }),
  ];
  (await Promise.allSettled(jobs)).filter((r) => r.status === "rejected").forEach((r) => console.warn(r.reason));
  if (Object.keys(row).length === 1) return;

  const rows = (await env.LENS.get("series", "json")) || [];
  const i = rows.findIndex((r) => r.d === d);
  if (i >= 0) rows[i] = row; else rows.push(row);
  rows.sort((a, b) => (a.d < b.d ? -1 : 1));
  await env.LENS.put("series", JSON.stringify(rows));
}

// /stocks/ZFCO                 -> /exchanges/LuSE/stocks/ZFCO
// /stocks/ZFCO/history?range=1Y -> /exchanges/LuSE/stocks/ZFCO/history?range=1Y
// /indices/LASI                -> /exchanges/LuSE/indices/LASI
// /exchange                    -> /exchanges/LuSE  (exchange overview, incl. index value)
function route(url, ex) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "exchange" && parts.length === 1) return `/exchanges/${ex}`;
  if (parts[0] === "stocks" && TICKERS.has(parts[1])) {
    if (parts.length === 2) return `/exchanges/${ex}/stocks/${parts[1]}`;
    if (parts.length === 3 && parts[2] === "history") {
      const range = url.searchParams.get("range") || "1Y";
      return RANGES.has(range) ? `/exchanges/${ex}/stocks/${parts[1]}/history?range=${range}` : null;
    }
  }
  if (parts[0] === "indices" && parts.length === 2 && INDICES.has(parts[1])) return `/exchanges/${ex}/indices/${parts[1]}`;
  return null;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
