/**
 * Market Watch quote parsing. Pure, shared by the `market-watch-refresh` edge
 * function and its tests.
 */

/** Our stable keys (market_quotes.symbol) → Yahoo Finance symbols. */
export const MARKET_SYMBOLS: { key: string; yahoo: string }[] = [
  { key: "NIFTY50", yahoo: "^NSEI" },
  { key: "SENSEX", yahoo: "^BSESN" },
  { key: "BANKNIFTY", yahoo: "^NSEBANK" },
  { key: "NIFTYMIDCAP100", yahoo: "NIFTY_MIDCAP_100.NS" },
  { key: "INDIAVIX", yahoo: "^INDIAVIX" },
  { key: "USDINR", yahoo: "INR=X" },
];

export interface ParsedQuote {
  price: number;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  /** ISO time of the source's last trade. */
  asOf: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Read a v8 chart response.
 *
 * Deliberately IGNORES `chartPreviousClose`: with range=1d it is the close
 * before the chart window, not the previous session's close (NIFTY 6 Nov 2026:
 * chartPreviousClose 23960.6 vs the true prior close 24536.6). The day change
 * comes from `fulldayChange` / `regularMarketChange`, falling back to the
 * percent fields, and the previous close is derived from it.
 */
// deno-lint-ignore no-explicit-any
export function parseYahooChart(body: any): ParsedQuote {
  const err = body?.chart?.error;
  if (err) throw new Error(err.description ?? err.code ?? "chart error");
  const meta = body?.chart?.result?.[0]?.meta;
  const price = num(meta?.regularMarketPrice);
  if (price === null || price <= 0) throw new Error("no price in response");

  const pct = num(meta.fulldayChangePercent) ?? num(meta.regularMarketChangePercent);
  let change = num(meta.fulldayChange) ?? num(meta.regularMarketChange);
  if (change === null && pct !== null && pct > -100) change = price - price / (1 + pct / 100);

  const prevClose = change !== null ? price - change : null;
  const changePct = pct ?? (change !== null && prevClose ? (change / prevClose) * 100 : null);

  const t = num(meta.regularMarketTime);
  return {
    price,
    change: change === null ? null : round(change, 4),
    changePct: changePct === null ? null : round(changePct, 4),
    prevClose: prevClose === null ? null : round(prevClose, 4),
    asOf: t ? new Date(t * 1000).toISOString() : null,
  };
}
