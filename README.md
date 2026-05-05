<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/fdc3e636-b24a-47be-8852-c36770cc3702

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the Supabase and Gemini values in [.env.local](.env.local).
3. Run the Supabase SQL setup below.
4. Run the app:
   `npm run dev`

## Host on GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys the app from `main`.

1. Push the repo to GitHub:
   `git push origin main`
2. In GitHub, open **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.

After the workflow finishes, the app will be available at:
`https://MinaMagdy555.github.io/National-Care-Approval-Flow/`

## Host on Vercel

1. Open Vercel and choose **Add New > Project**.
2. Import `MinaMagdy555/National-Care-Approval-Flow`.
3. Use these settings:
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Click **Deploy**.

Vercel will deploy from `main` automatically after each push.

## Supabase Setup

1. In Supabase, open **Project Settings > API**.
2. Copy the Project URL and publishable/anon public key.
3. Add these environment variables locally and in Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ADMIN_EMAIL`
4. In [supabase.sql](supabase.sql), change `mina@example.com` in `app_private.settings.bootstrap_admin_email` to Mina's real email.
5. In Supabase, open **SQL Editor** and run the SQL from [supabase.sql](supabase.sql).
6. In **Authentication > Providers > Email**, keep email confirmation enabled.
7. Optional Google sign-in setup:
   - In Google Cloud, create an OAuth Client ID with application type **Web application**.
   - In Google Cloud **Authorized JavaScript origins**, add `http://localhost:3000` and your deployed app origin.
   - In Google Cloud **Authorized redirect URIs**, add your Supabase callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - In Supabase **Authentication > Providers > Google**, turn Google on, paste the Google client ID/secret, and save.
   - In Supabase **Authentication > URL Configuration**, set the Site URL to your deployed app URL and add redirect URLs for `http://localhost:3000/**` plus your deployed app URL.
8. Create Mina's account with the same email from step 4. After email confirmation, Mina is auto-approved as admin/reviewer.
9. Other users can register with email/password or Google. Mina/admin approves them in **Account Approvals** and can map old `user_1` through `user_6` data during approval.

Run `npm run check:supabase` after applying the SQL. Add `SUPABASE_TEST_EMAIL` and `SUPABASE_TEST_PASSWORD` for an approved user if you want the script to test authenticated reads, writes, and uploads.
