# Riftbound Card Lab

Measures which cards raise or lower a Riftbound legend's match win rate, using public tournament
results and decklists from the [TopDeck.gg](https://topdeck.gg) API.

- `pipeline/` (Python): downloads results, builds a DuckDB database and exports JSON stats.
- `src/` (TypeScript + Vite): a static web app that reads the JSON from `public/data/`.

The site has no backend. Vercel serves the built `dist/` folder, and the API key stays on your machine.

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
npm install
cp .env.example .env   # then add TOPDECK_API_KEY
```

## Refreshing the data

```sh
npm run data          # fetch new events → rebuild DB → re-export public/data
npm run data:analyze  # rebuild + re-export from cached downloads only
npm test              # pipeline unit tests
```

Raw API responses are cached in `pipeline/data/raw/` (gitignored). Only the latest time window
is re-downloaded on each run. Commit the updated `public/data/` and redeploy.

## Running and deploying

```sh
npm run dev               # local dev server
npx vercel deploy --prod  # deploy (after `npx vercel login`)
```

The site is meant to be unlisted. `robots.txt`, a `noindex` meta tag and an `X-Robots-Tag` header
keep it out of search engines, so only people with the link find it.

## Method in brief

For each meta period (split at set releases), legend and card, the app compares matches played by
decks with and without the card, mirrors excluded. A logistic regression adjusts for opponent
legend, player skill (win rate in *other* events, shrunk toward 50%) and top-cut rounds, plus set
period for "All time". Standard errors are clustered by deck, and p-values get Benjamini–Hochberg
correction within each legend. The in-app **Method** page has the details and caveats.

## Data and terms

- TopDeck.gg's developer terms require visible attribution (shown in the site footer) and forbid
  commercializing the data or profiling individual players. Player IDs are hashed and never exported.
- This project does not use Riot's Riftbound API. Riot's API policy prohibits publishing win rates
  through apps that use it.
- Unofficial fan project, not affiliated with or endorsed by Riot Games.
