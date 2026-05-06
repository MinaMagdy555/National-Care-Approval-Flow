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
2. Run the app:
   `npm run dev`

## Demo Accounts

The app uses fake local accounts. No email confirmation, external provider, or admin approval is required.

| Account | Password |
| --- | --- |
| Mina M. Bashir | `Password 1` |
| Dina ElAlfy | `Password 2` |
| Marwa ElKady | `Password 3` |
| Mariam | `Password 4` |
| Noreen | `Password 5` |
| Yomna | `Password 6` |
| Ahmed Fawzy | `Password 7` |

## Shared Data

To share the same tasks between devices, keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`, then run `supabase.sql` in the Supabase SQL Editor for that project. The fake accounts use the public anon key, so the SQL includes demo RLS policies for `approval_tasks`, `approval_notifications`, and the `task-files` bucket.

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
