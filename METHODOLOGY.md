# Methodology

How LuSE Stock Lens turns prices into conclusions about **ZAFFICO (ZFCO)** and **Copperbelt Energy (CECZ)**.

Every number in the page's "Econometric analysis" section is recomputed from the data each time the page loads, using the same steps for both stocks. The code is the `Econ` script block in [`public/index.html`](public/index.html), and the function names below refer to it.

Not investment advice.

## Contents

1. [The questions](#1-the-questions)
2. [Data](#2-data)
3. [Notation](#3-notation)
4. [Splitting a price move into its parts](#4-splitting-a-price-move-into-its-parts)
5. [Volatility](#5-volatility)
6. [Is the company-specific move unusual?](#6-is-the-company-specific-move-unusual)
7. [Market beta, corrected for thin trading](#7-market-beta-corrected-for-thin-trading)
8. [ZAFFICO: pull back towards the expected price](#8-zaffico-pull-back-towards-the-expected-price)
9. [Copperbelt Energy: is it priced in dollars?](#9-copperbelt-energy-is-it-priced-in-dollars)
10. [Likely price ranges](#10-likely-price-ranges)
11. [Thin-trading measure](#11-thin-trading-measure)
12. [Decision rules](#12-decision-rules)
13. [Why these methods suit LuSE stocks](#13-why-these-methods-suit-luse-stocks)
14. [Limitations](#14-limitations)
15. [References](#15-references)

## 1. The questions

Both stocks have fallen sharply, and the headline price change is misleading for each:

- **ZAFFICO** issued one new share at K2.53 for every share held (ex-rights 22 July 2026). How much of the fall is just that dilution, and how much is the market or the company itself?
- **Copperbelt Energy** reports in US dollars, but its shares trade in kwacha. The kwacha strengthened this year. How much of the fall is the currency, and how much is the market or the company itself?

For each stock the analysis:

1. Splits the move into parts, exactly.
2. Tests whether the part left over is more than normal noise.
3. Estimates how the stock relates to the market, and to the currency or the rights price.
4. Gives a likely price range.

## 2. Data

| Source | Series | Notes |
|---|---|---|
| Mansa Markets API, via the Worker | Live ZFCO and CECZ prices, LASI level | Cached 30 minutes |
| Daily collector (Cloudflare Cron Trigger and KV) | One row per trading day: closes, volumes, LASI, kwacha per US$ | Runs 07:00 Lusaka time, Tuesday to Saturday. Mansa's LuSE figures lag a day, so each row is labelled with the previous weekday. |
| open.er-api.com | Kwacha per US$ | Read by the daily collector |
| Hand-collected closes, in `SNAPSHOT` | ~16–19 dated closes per stock from June 2026 | LuSE daily data, Mansa Markets wraps, AfricanFinancials; sources in the [README](README.md) |
| Reference figures, in `REF` | Rights terms, EPS, dividend, 1 January prices and exchange rate | Filings and results; sources in the README |

**Cleaning:**

- **Merging.** Collected rows and hand-collected closes are merged by date. Where both have a date, the collected value wins.
- **No fresh data.** A collected row is dropped when its price and volume (or the LASI level) both equal the previous row's. That usually means a market holiday or a feed that hasn't updated.
- **Rights adjustment.** For return-based estimates (volatility and beta), ZAFFICO prices before the ex-date are multiplied by the adjustment factor $f$ (section 4). This removes the mechanical drop so it isn't counted as a market return. The split in section 4 uses unadjusted prices and shows the dilution as its own part.
- **Trading days.** The gap between two observations is the number of weekdays between them. LuSE holidays are not modelled.

## 3. Notation

| Symbol | Meaning |
|---|---|
| $P_t$ | Share price (kwacha) at date $t$ |
| $M_t$ | LASI level |
| $X_t$ | Kwacha per US dollar |
| $r_i = \ln(P_{t_i}/P_{t_{i-1}})$ | Log return over interval $i$, between consecutive observations |
| $m_i$, $f_i$ | Log return of the LASI and of $X$ over the same interval |
| $h_i$ | Trading days the interval covers ($\ge 1$) |
| $n$ | Number of intervals |

Prices are observed at irregular dates, so every estimator works with intervals of different lengths. They all assume variance grows in proportion to trading days, as in a random walk.

## 4. Splitting a price move into its parts

*Function: `attribute`.*

Log returns add up, so a move over a window can be split exactly:

$$
\underbrace{\ln\frac{P_T}{P_0}}_{\text{total}} \;=\; \underbrace{K}_{\text{known effect}} \;+\; \underbrace{\beta \ln\frac{M_T}{M_0}}_{\text{market}} \;+\; \underbrace{\varepsilon}_{\text{company-specific}}
$$

The company-specific part $\varepsilon$ is what's left after the other two are taken out.

**ZAFFICO.** The window runs from the last close before the ex-date, $P_0 = P_{\text{cum}}$, to the latest close. The known effect is the dilution from the rights issue. The theoretical ex-rights price (TERP) is:

$$
\text{TERP} = \frac{P_{\text{cum}} N_{\text{old}} + S\,N_{\text{new}}}{N_{\text{old}} + N_{\text{new}}}, \qquad f = \frac{\text{TERP}}{P_{\text{cum}}}, \qquad K = \ln f
$$

Here $S = $ K2.53 is the offer price, and $N_{\text{new}} = N_{\text{old}} = 400\text{m}$ (one-for-one, full take-up). With $P_{\text{cum}} = $ K10.52, TERP = K6.53 and $\ln f = -0.478$, a 38.0% price effect.

**Copperbelt Energy.** The window runs from 31 December 2025 to the latest close. CEC's earnings are in dollars. If the market values it in dollars, the kwacha price is the dollar price times the exchange rate. Its log therefore moves one-for-one with $\ln X$:

$$
K = \ln\frac{X_T}{X_0}
$$

The rest of the move is the change in CEC's dollar price, which is then split into market and company-specific parts. Section 9 tests whether this one-for-one assumption holds.

**Market part.** $\beta$ is the Dimson beta from section 7 once there are at least 20 matched observations. Until then $\beta = 1$, the *market-adjusted model* (Brown and Warner, 1985), which is the standard choice when there's too little data to estimate beta. The LASI level is taken on or before each window date.

**Display.** Bars are drawn in log units, so their lengths add up to the total. Labels show the price effect of each part, $e^{c} - 1$. Price effects multiply rather than add, so the labels don't sum exactly to the total.

*Worked example, ZAFFICO, 20 July to 13 October 2026.* The price went from K10.52 to K5.67, a total of $\ln(5.67/10.52) = -0.618$, or −46.1%. This splits into:

- rights issue: −0.478 (−38.0%, 77% of the log move)
- market, with $\beta = 1$: −0.016 (−1.6%)
- company-specific: −0.125 (−11.7%)

## 5. Volatility

*Function: `volatility`. Needs at least 8 intervals.*

With irregular gaps, daily variance is estimated as the sum of squared returns over the total trading days covered:

$$
\hat\sigma^2_{\text{daily}} = \frac{\sum_i r_i^2}{\sum_i h_i}, \qquad \hat\sigma_{\text{annual}} = \hat\sigma_{\text{daily}}\sqrt{252}, \qquad \text{SE}(\hat\sigma_{\text{annual}}) \approx \frac{\hat\sigma_{\text{annual}}}{\sqrt{2n}}
$$

The mean return is not subtracted. Over short horizons the mean is negligible next to the variance, and estimating it from a few points adds noise.

## 6. Is the company-specific move unusual?

*Inside `attribute`.*

The company-specific part is compared with how much this stock normally moves over the same number of trading days $D$:

$$
z = \frac{\varepsilon}{\hat\sigma_{\text{daily}}\sqrt{D}}
$$

The two-sided p-value comes from a $t$ distribution with $n-1$ degrees of freedom, because $\hat\sigma$ is estimated. This is the standard event-study test of an abnormal return.

The volatility estimate includes the window being tested. Big moves in the window therefore make $\hat\sigma$ larger and the test conservative. When fewer than 31 prices are behind the volatility estimate, a non-significant result says so explicitly: the test can only detect large moves.

## 7. Market beta, corrected for thin trading

*Function: `dimsonBeta`. Needs at least 20 matched intervals.*

Thinly traded stocks react to market news late: a price may not change until the next trade. An ordinary regression of a stock's return on the market's same-day return then understates beta. The Dimson (1979) estimator adds the market's return over the previous interval and the next interval, and sums the three slopes:

$$
\frac{r_i}{\sqrt{h_i}} = a\frac{h_i}{\sqrt{h_i}} + b_{-1}\frac{m_{i-1}}{\sqrt{h_i}} + b_{0}\frac{m_{i}}{\sqrt{h_i}} + b_{+1}\frac{m_{i+1}}{\sqrt{h_i}} + u_i, \qquad \hat\beta = b_{-1} + b_0 + b_{+1}
$$

- **Weighting.** Dividing by $\sqrt{h_i}$ is weighted least squares. An interval spanning $h$ days has $h$ times the variance of a one-day interval, so this weights each interval fairly.
- **Drift.** The term $a\,h_i$ is a drift per trading day.
- **Matching.** Stock and LASI returns are computed over the same dates, using only dates both series have.
- **Standard error.** $\text{SE}(\hat\beta) = \sqrt{c^\top \hat V c}$ with $c = (0,1,1,1)$, where $\hat V$ is the OLS covariance matrix of the coefficients. Tested against $\beta = 0$ with a $t$ distribution, $n - 4$ degrees of freedom.

## 8. ZAFFICO: pull back towards the expected price

*Function: `reversion`. Needs at least 10 intervals since the ex-date.*

If TERP is a fair anchor after the rights issue, the gap between price and TERP should shrink over time. Let $x_t = \ln(P_t/\text{TERP})$ on prices from the ex-date onwards. A discrete Ornstein–Uhlenbeck model says the gap decays at rate $\kappa$ per trading day:

$$
x_{t_i} - x_{t_{i-1}} = -\kappa\,h_i\,x_{t_{i-1}} + e_i
$$

Weighted by $1/\sqrt{h_i}$ as above, this is a regression with no intercept of $\Delta x_i/\sqrt{h_i}$ on $\sqrt{h_i}\,x_{t_{i-1}}$. The slope is $-\kappa$.

- **Half-life** $= \ln 2 / \kappa$ trading days: the time for half of any gap to close.
- **Rule.** The pull is reported as real only if $\kappa > 0$ and $p < 0.05$.
- **Caveat.** TERP assumes every new share was taken up. With lower take-up, the true anchor sits between TERP and the pre-rights price. The take-up result had not been published where we could find it.

## 9. Copperbelt Energy: is it priced in dollars?

*Function: `fxElasticity`. Needs at least 20 collected days with CECZ, LASI and the exchange rate.*

Section 4 assumes the kwacha price moves one-for-one with kwacha per dollar. This regression tests that assumption, controlling for the market:

$$
\frac{r_i}{\sqrt{h_i}} = a\frac{h_i}{\sqrt{h_i}} + \gamma\frac{f_i}{\sqrt{h_i}} + \delta\frac{m_i}{\sqrt{h_i}} + u_i
$$

Two tests on $\gamma$:

- $H_0: \gamma = 0$ checks whether there is any currency link at all.
- $H_0: \gamma = 1$ checks whether the market prices CEC as a pure dollar asset.

Significant against 0 but not against 1 supports the dollar-pricing view behind section 4. Significant against both means the currency matters, but less than one-for-one, so section 4 overstates the currency's share.

## 10. Likely price ranges

*Function: `range`.*

Assuming recent volatility continues and there is no drift, the log price after $H$ trading days is normal around today's log price:

$$
\left[\,P_T\,e^{-z\,\hat\sigma_{\text{daily}}\sqrt{H}},\; P_T\,e^{+z\,\hat\sigma_{\text{daily}}\sqrt{H}}\,\right]
$$

- $z = 1.2816$ for an 80% range, $1.96$ for 95%.
- $H = 21$ trading days (about one month) or $63$ (about three months).

These ranges describe uncertainty, not direction. The median of the range is today's price. They also ignore fat tails and the uncertainty in $\hat\sigma$ itself, so the true range is wider.

## 11. Thin-trading measure

*Function: `zeroShare`. Needs at least 10 collected days.*

This is the share of collected trading days on which the price didn't change, a standard proxy for illiquidity and trading costs (Lesmond, Ogden and Trzcinka, 1999). It uses only collected daily rows, because the hand-collected closes are not consecutive days.

## 12. Decision rules

Each finding on the page carries one label. The rules are fixed, so as data arrives a label can change, for example from "Needs more data" to a result, or from not significant to significant.

| Label | Rule |
|---|---|
| **Exact arithmetic** | The split in section 4. No estimation and no uncertainty, apart from the market part when $\beta$ is estimated. |
| **Statistically significant** | Two-sided $p < 0.05$. For section 8, also $\kappa > 0$. |
| **Not statistically significant** | $p \ge 0.05$. With fewer than 31 prices, the finding says the test can only detect large moves. Read it as "can't tell", not as proof of no effect. |
| **Estimate** | Volatility and likely ranges, reported with a standard error or a stated assumption. |
| **Needs more data** | Below the minimum: 20 intervals for regressions, 10 for reversion and the zero-return share, 8 for volatility. The page says how many observations exist and roughly how many trading days until a result. |

The minimums are set in the `MIN_*` constants at the top of the `Econ` block.

## 13. Why these methods suit LuSE stocks

- **Thin trading.** Many LuSE shares don't trade every day, and a single order can move the price. Ordinary betas are biased towards zero, so the Dimson correction is used. Daily-return models like ARIMA or GARCH would mostly be fitting stale prices.
- **Irregular, scarce data.** The free API plan has no history. Until the collector builds a daily series, the data is a few dozen hand-collected closes at uneven dates. Every estimator is written for uneven intervals, weighted by their length, and refuses to report below a minimum sample size.
- **Known mechanical effects.** For both stocks the biggest driver can be calculated exactly: dilution for ZAFFICO, the currency for CEC. Taking these out first, before any statistics, gives conclusions that don't depend on sample size.
- **Explaining over forecasting.** With this data, no model can reliably predict direction. The analysis therefore explains past moves and gives honest ranges rather than price targets.

## 14. Limitations

- **Small samples.** Until about 20 trading days have been collected (around mid-November 2026), most tests have little power.
- **Holidays.** LuSE holidays count as trading days, which slightly overstates $h_i$ around them.
- **Stale prices.** Thin trading makes prices stale. That understates volatility for rarely traded stocks like CEC, so its ranges are too narrow.
- **Static reference figures.** EPS, the rights take-up, dividends and the 1 January prices in `REF` are fixed. New filings need a manual update. The CEC "this year" window must be reset each January.
- **Market proxy.** The LASI is priced in kwacha and is itself affected by the currency. That makes CEC's market and currency parts partly overlap.
- **Data provider.** Collection depends on Mansa's field names (`price`, `index_value`) and on its one-day lag. A change in either shows up as gaps or mislabelled days in the collected rows.

## 15. References

- Brown, S. J., & Warner, J. B. (1985). Using daily stock returns: The case of event studies. *Journal of Financial Economics*, 14(1), 3–31.
- Dimson, E. (1979). Risk measurement when shares are subject to infrequent trading. *Journal of Financial Economics*, 7(2), 197–226.
- Lesmond, D. A., Ogden, J. P., & Trzcinka, C. A. (1999). A new estimate of transaction costs. *Review of Financial Studies*, 12(5), 1113–1141.
- Uhlenbeck, G. E., & Ornstein, L. S. (1930). On the theory of the Brownian motion. *Physical Review*, 36(5), 823–841.
