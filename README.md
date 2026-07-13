# Factor20

Evidence-based stock ranking website. A transparent factor model (Quality 30% ·
Value 25% · Momentum 25% · Growth 20%, percentile-normalized, minus penalties)
ranks S&P 500 stocks nightly; Claude Opus 4.8 writes an interpretation of the
top 20. No predictions, no black box.

## Stack

- **Next.js** website (deploy on Vercel)
- **Finnhub** free tier — fundamentals, quotes, insider transactions (60 calls/min)
- **Yahoo Finance** — free daily OHLC history (trend filter, momentum, charts)
- **SEC EDGAR** — free official filings data (Altman Z, Piotroski F, accruals,
  FCF growth, Gross Profit/Assets, Debt/EBITDA — computed in `src/lib/edgar.ts`)
- **Claude Opus 4.8** via the Message Batches API (50% off) — AI write-ups
- **No database** — the nightly job writes `data/*.json`, committed by a
  GitHub Action, which triggers a Vercel redeploy

## Setup

```bash
npm install
copy .env.example .env.local   # then fill in FINNHUB_API_KEY + ANTHROPIC_API_KEY
```

## Commands

```bash
npm run universe               # build the full US >$1.5B universe (~1,300 tickers, ~2h, run monthly)
npm run scan                   # nightly scan (~90 min full universe; ~30 min S&P 500 fallback)
npm run scan -- --limit 60     # quick test scan
npm run analyze                # Claude batch analysis of top 20 (~$0.40/run)
npm run analyze -- --direct --top 3   # immediate calls, for testing
npm run dev                    # website at localhost:3000
```

**Universe:** until `npm run universe` has been run once, scans fall back to
the S&P 500 (~503 tickers). After it runs, scans cover every US-listed common
stock above ~$1.5B market cap (~1,300+ tickers) — the spec's actual universe.
The universe rebuilds monthly via `.github/workflows/universe.yml`.

## Deploying

1. Push this repo to GitHub.
2. Add repo secrets `FINNHUB_API_KEY` and `ANTHROPIC_API_KEY`
   (Settings → Secrets and variables → Actions).
3. Import the repo in Vercel — zero config needed.
4. The nightly workflow (`.github/workflows/nightly.yml`) scans, analyzes,
   commits `data/`, and Vercel redeploys automatically.

## Free-tier approximations

The model spec is implemented in `src/lib/scoring.ts` + `src/lib/edgar.ts`.
Nearly everything in the spec is computed from free sources (Finnhub free +
SEC EDGAR + Yahoo). Remaining gaps, reported on each scan in `skippedFilters`:

| Missing input | Spec role | Why / fix |
|---|---|---|
| Forward EPS growth | Growth 15% | needs paid analyst estimates (e.g. FMP Starter ~$19/mo); weight renormalized |
| "Accounting red flags" | penalty −20 | no objective free-data definition; the accrual ratio partially covers it |

Notes:
- Altman Z is null for banks/insurers (no working-capital line items) — the
  formula isn't designed for financials, so the filter is skipped there.
- Piotroski F is scaled to /9 when at least 7 of 9 criteria are computable.
- Universe: full US common stocks >$1.5B once `npm run universe` has run
  (S&P 500 fallback before that) — see the Universe note above.

## Disclaimer

Factor20 is a screening/education tool. Nothing it outputs is investment
advice.
