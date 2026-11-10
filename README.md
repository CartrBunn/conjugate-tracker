# Conjugate Tracker

Coach-facing tracker for conjugate training programs: groups, tracked lifts, athlete logging
(join code + athlete number + PIN), and cycle reviews. Athletes are numbers only — the app
stores no names or other athlete personal data. Static React app on GitHub Pages, backed by Supabase.

Specs: [docs/plans/conjugate-tracker-app.md](docs/plans/conjugate-tracker-app.md),
[docs/plans/athlete-pin-sign-in.md](docs/plans/athlete-pin-sign-in.md).

## Setup

1. **Create a Supabase project** (free tier) at supabase.com.
2. **SQL Editor:** run each file in `supabase/migrations/` in order (`0001` → `0006`), then
   `supabase/seed/exercises.sql`. Each migration runs once; don't re-run `0001` or `0004`.
3. **Authentication → Sign In / Providers:** turn on **Allow anonymous sign-ins** (athletes).
   Leave Email on with its default settings (coaches use email + password).
4. **Authentication → URL Configuration → Site URL:** `http://localhost:5180/conjugate-training/` while testing;
   change it to the GitHub Pages URL once deployed. The signup confirmation link goes here.
5. **Local env:** copy `.env.example` to `.env.local` and fill in the URL and anon key from
   Project Settings → API.
6. Run it:

   ```bash
   npm install
   npm run dev
   ```

## Deploy (GitHub Pages)

1. Push to a GitHub repo (the site's path is the repo name, e.g. `/conjugate-training/`).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Repo → Settings → Secrets and variables → Actions → **Variables**: add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Push to `main`; `.github/workflows/deploy.yml` tests, builds and deploys.

Supabase free projects pause after about a week with no traffic; un-pause from the dashboard.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Local dev server |
| `npm test` | Unit tests (program math, seed sanity) |
| `npm run build` | Type-check + production build |
