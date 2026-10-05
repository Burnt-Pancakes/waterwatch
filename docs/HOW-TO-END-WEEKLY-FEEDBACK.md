# How to end the weekly feedback email

Two one-line actions to stop and remove the weekly focus-group feedback report.

- **Stop the emails:** `SELECT cron.unschedule('waterwatch-weekly-feedback');` (run in the Supabase SQL editor).
- **Remove the endpoint:** delete `src/routes/api/public/send-weekly-feedback.ts` from the repo and redeploy (there is no edge function to delete — new edge functions could not be created in this project, so the report runs as an app server route).
