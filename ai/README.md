# Samurai Meet — AI service (`ai/`)

Standalone Next.js (App Router) service that owns the AI features. It runs
alongside the existing Go backend (`backend/`) and Expo app (`frontend/`) —
nothing here replaces them. AI-adjacent data lives in Supabase.

```
ユーザー → Next.js → app/api/*
                       ├─ OpenAI            classify / translate / profile assist / moderation / monster image
                       └─ Google Maps       location display name
                     → Supabase             users · requests · messages · translations · monster_images
```

## What is done vs. what the AI owner does

This PR is the **Next.js half only**. Split:

| Done here (review this) | AI owner fills in |
| --- | --- |
| Routing, method handling, error envelope | `lib/ai.ts` — 5 OpenAI functions |
| `zod` request validation (`lib/validation.ts`) | `lib/geo.ts` — `resolveLocationName` (Google Maps) |
| IP rate limiting (`lib/ratelimit.ts`) | |
| Shared-secret gate (`lib/http.ts`) | |
| Supabase persistence + translation cache + monster seed-hash / regen limit (`lib/db.ts`, `lib/hash.ts`) | |
| Failure-policy mapping per route (`lib/http.ts` `mapUpstreamError`) | |
| Prompt text ported from the Go backend (`lib/prompts.ts`) | |
| Schema (`supabase/migrations/0001_init.sql`) | |

Every stub throws `NotImplemented`, so those routes currently return **`501`**.
`GET /api/health` reports `ai_logic_implemented: false`.

### To implement the AI logic

1. `npm i` (adds the `openai` SDK, already in `package.json`).
2. In `lib/ai.ts`, create one `OpenAI` client and implement:
   `classifyRecruitment`, `translateText`, `assistProfileText`, `moderateText`,
   `generateMonsterImage`. Contract rules are in the file header.
3. In `lib/geo.ts`, implement `resolveLocationName` using Geocoding + Places.
4. Delete the `void env;` lines once `env` is actually referenced.

## Routes

| Method | Path | Body / query | Failure policy |
| --- | --- | --- | --- |
| POST | `/api/requests/classify` | `{ activity, where? }` | fail-closed → `502` |
| POST | `/api/translate` | `{ message_id, text, target_language }` | fail-open → `503 degraded`, cache by `(message_id, target)` |
| POST | `/api/profile/assist` | `{ text, mode }` | fail-open, result never persisted |
| POST | `/api/moderation` | `{ text, context, target? }` | `chat` fail-closed; `recruitment`/`profile` fail-open |
| POST | `/api/monster` | `{ user_id, seed:{skills,interests,note?}, regenerate? }` | fail-closed; seed reuse; `MONSTER_REGEN_LIMIT` |
| GET | `/api/location/name` | `?lat=&lng=` | fail-open (client keeps device-side name) |
| GET | `/api/health` | — | — |

Success shape: `{ "data": ... }`. Error shape: `{ "error": { "code", "message" }, "degraded"? }`.

All routes except `/api/health` require the `x-ai-secret` header to equal
`AI_SERVICE_SHARED_SECRET` (skipped with a warning if that var is unset and
`NODE_ENV !== production`).

## Local development

```bash
cd ai
npm install
cp .env.example .env.local     # fill in what you have
npm run dev                    # http://localhost:3001
npm run typecheck
npm run lint

curl localhost:3001/api/health
curl -XPOST localhost:3001/api/requests/classify \
  -H 'content-type: application/json' \
  -d '{"activity":"I want to eat ramen near Kyoto Station","where":"Kyoto Station"}'
# -> 501 not_implemented  (until lib/ai.ts is done)
```

## Supabase setup

1. Create a project, run `supabase/migrations/0001_init.sql` in the SQL editor.
2. Create a public bucket `monsters` (snippet at the bottom of the migration).
3. Put `SUPABASE_URL` and the **service-role** key in `.env.local` /
   deployment env. The service-role key is server-only — never expose it.

RLS is enabled with no policies: only the service-role key (the route handlers)
can touch the tables. Add per-user policies when real auth is introduced.

## Notes / deferred

- **Auth**: none yet. `x-ai-secret` + IP rate limiting is the stopgap. Later:
  Supabase Auth or verifying the Go backend's JWS access token, plus RLS.
- Prompts are ported from `backend/internal/classification/gemini.go` and
  `backend/internal/translation/gemini.go` (Gemini → OpenAI). Keep them
  versioned in `lib/prompts.ts`.
- No admin/moderation queue, no image-input moderation — out of scope.
- Rate limiter is in-memory (single instance). Swap for KV/Redis before
  horizontal scaling.
