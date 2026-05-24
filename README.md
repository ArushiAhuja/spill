# Spill — Social Signal Monitor

Real-time social monitoring dashboard. Tracks Reddit, Hacker News, Google News, Twitter, and Play Store for any company.

Live: https://app-eight-theta-20.vercel.app

---

## Run locally

```bash
cd ~/Desktop/spill
npm install
npm run dev
```

Open http://localhost:3000

That's it. The `.env.local` file already has all credentials — no setup needed.

---

## How Reddit fetching works

Reddit blocks direct API calls from cloud servers (AWS/Vercel Lambda). The fix:

- A **Vercel Edge Function** at `/api/internal/reddit-fetch` runs on **Cloudflare's network** instead of AWS
- Reddit's RSS feed returns 200 from Cloudflare (JSON returns 403)
- The Lambda scheduler calls this edge endpoint to get Reddit posts
- Locally, `APP_URL=http://localhost:3000` so the scheduler calls your local edge endpoint

This means Reddit works identically in local dev and on Vercel — no Reddit app or OAuth needed.

---

## Trigger a manual refresh (local)

```bash
curl -X POST http://localhost:3000/api/cron/refresh \
  -H "x-cron-secret: 5143e513b65c8c9bdfe9b0d3c2080c2d718278bf118000761aba5e26f5ddea07"
```

Or just click the **refresh** button in the dashboard UI.

---

## Add a new org

1. Sign up / log in at http://localhost:3000
2. Go to http://localhost:3000/onboarding
3. Fill in company name + description → AI auto-generates search queries and categories
4. Enable sources in Settings → Reddit, Google News, HN, etc.
5. Click refresh on the dashboard

---

## Project structure

```
src/
  app/
    [org]/          Dashboard, categories, escalations, settings pages
    api/
      auth/         Login / signup
      orgs/[slug]/  Posts, sources, categories, refresh, status
      cron/refresh  Periodic refresh endpoint (called by Vercel cron or manually)
      internal/
        reddit-fetch  Edge function — fetches Reddit via RSS from Cloudflare
  server/
    fetchers/       reddit.js, hackernews.js, news.js, playstore.js, twitter.js
    scheduler.js    runOrgCycle — fetches + classifies + stores posts
    classifier.js   Claude/OpenAI categorisation
    db.js           Neon Postgres connection
```

---

## Deploy to Vercel

```bash
cd ~/Desktop/spill
vercel --prod
```

Env vars are already set on the Vercel project. Nothing else needed.
