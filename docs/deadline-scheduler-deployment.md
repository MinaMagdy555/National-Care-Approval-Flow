# Deadline reminder scheduler

The server endpoint is `GET /api/cron/deadline-reminders` (POST is also accepted). It runs without an open browser and writes in-app notifications to the shared Neon state. This implementation has been tested locally with an isolated database fixture; no production deployment, secret update, scheduler activation, or production database write was performed.

## Activate a minute-level trigger

Configure a private, random `CRON_SECRET` in the server environment. The trigger must send `Authorization: Bearer <CRON_SECRET>`. The endpoint refuses all invocations when the secret is missing, and rejects missing or incorrect authorization before accessing data. Do not put this secret in a `VITE_` variable, URL, checked-in configuration, browser code, or logs. The existing private `DATABASE_URL` and Supabase directory configuration are also used; the cron secret is never sent to Supabase.

The local project link identifies `national-care-approval-flow`, but its linked team's plan could not be verified with the available account. The separately accessible team's Hobby plan is not evidence of this project's plan. `vercel.json` intentionally has no active cron entry. Choose and configure one of these deployment paths:

- On a verified Vercel Pro or Enterprise project, merge the `crons` property from `vercel.cron-pro.example.json` into the deployment's `vercel.json`. Vercel supplies the configured `CRON_SECRET` as the authorization bearer value. Cron schedules run on production deployments.
- On another plan, configure an external scheduler to call the deployed endpoint every minute with the same authorization header. Use the scheduler's encrypted secret storage and enable failure monitoring/retries. A daily trigger cannot provide the required one-hour reminder timing.

Current [Vercel cron usage documentation](https://vercel.com/docs/cron-jobs/usage-and-pricing), checked September 14, 2026, permits 100 jobs on each plan. Hobby runs at most daily with hourly precision; Pro and Enterprise permit a one-minute interval. Do not add the minutely entry to an unverified Hobby deployment because it will fail deployment. The older bundled skill's 2/40 job counts are outdated.

After deploying and configuring the trigger, verify an authenticated test task's two reminder stages, inspect scheduler success/failure responses, confirm repeated invocation does not duplicate notices, and verify delivery with all browsers closed. Until a trigger is actually configured, background reminders are not active. Vite exposes the same handler for isolated local testing, but does not run a timer for it.

## Timing, audience, and durable delivery

The pure planner uses the deadline instant, not publishing dates. At each tick it sends a `within 24 hours` reminder while more than one hour and no more than 24 hours remain, or a `within 1 hour` reminder during the final hour. It never sends both stages at once and never sends an obsolete 24-hour notice after the final-hour window has started. A missed tick can deliver later inside the current window; downtime through the deadline produces no misleading overdue pre-deadline notice. Task creation inside a window follows the same rule.

Only current, available workflow owners, their configured/inferred senior, and nonsenior leadership receive notices or see the deadline calendar. Future assignees and creator-only relationships do not grant visibility; senior status overrides administrative tooling. Returned work uses the current revision uploader. Completed, final-approved, and archived tasks are excluded. Delayed phases become eligible only when available. Notification reads recheck the current deadline and audience, so reassignment or changed deadlines hide obsolete notices.

Every delivery has a deterministic ID keyed by task ID, canonical deadline timestamp, stage, and recipient. Separate `Task.deadlineReminderReceipts` survive notification removal. Changing the deadline creates new eligibility; repeated ticks, concurrent runs, and cleared notifications do not resend an existing delivery. The scheduler writes notices and receipts together with a compare-and-swap on the shared state's revision. A conflict triggers up to four fresh reads and replans; failure returns a retryable 409/503 without a partial delivery receipt. Regular authenticated state saves preserve the server's receipts and notices even when the submitting browser has an older snapshot.

Local-only previews use the same planner while open and persist receipts with tasks. Neon clients do not generate deadline notices. Drive mode has no background deadline scheduler; this deployment path targets the configured Neon backend.

## Deadline representation

New deadline inputs are interpreted in `Africa/Cairo` with its daylight-saving rules and stored as ISO timestamps. Business-hour checks also use Cairo time, regardless of browser/server timezone. The parser rejects invalid dates and relative text such as “tomorrow.” Legacy ISO date/time text is supported deterministically; a date-only `YYYY-MM-DD` deadline means **23:59 Cairo time on that date**. Ambiguous slash-formatted legacy dates require an explicit deadline edit. The calendar and scheduler share these parsing rules.

## Daily reports (task 20)

The same authenticated minute-level endpoint also plans daily reports. At 17:15 Africa/Cairo on configured working days it persists one owner reminder and a private draft. At or after 17:29 on that same Cairo day it fills recorded sessions/uploads/review actions, preserves manual edits and side work, and submits nonempty reports to the existing reporting hierarchy. Art Directors and Marketing Managers remain exempt. Empty reports are not submitted. Late same-day invocations catch up; older days are not silently backfilled. Warning receipts and sent timestamps survive notification cleanup and retries. All report/notification writes share the endpoint’s atomic revision check.

The deployed minute-level trigger and CRON_SECRET remain prerequisites for unattended operation. Neither production deployment nor trigger activation was performed in this editing session. Local previews use the same planner only while open; the actual server handler was also verified with the test app page closed.
