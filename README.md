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
| Eng. Fawzy, Manager (`ahmed.mostafa.fawzy@gmail.com`) | `Password 7` |
| Omar Mansour, Developer (`omarmansoour96@gmail.com`) | `Password 8` |

## Workflow Features

- Team leaders, reviewers, art directors, and admins can reassign contributors and current workflow owners from a task detail page.
- Review routes can be changed per task between Full Review, Quick Look, and Direct to Art Director. Pending tasks move to the matching queue immediately; returned tasks use the new route after resubmission.
- Campaign tasks can include a publish date/time and note. The Campaign Scheduler shows month, overdue, upcoming, and published views, with in-app reminders while the app is open.

## Shared Data

To share the same tasks between devices, configure Google Drive shared storage in `.env.local`:

```env
VITE_USE_SHARED_DRIVE_DATA=true
VITE_GOOGLE_CLIENT_ID="YOUR_GOOGLE_OAUTH_WEB_CLIENT_ID"
VITE_GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
VITE_GOOGLE_APP_ID="YOUR_GOOGLE_CLOUD_PROJECT_NUMBER"
```

In Google Cloud, enable the Google Drive API and Google Picker API, create a web OAuth client, and add the deployed app origin to the OAuth client. After signing into a demo account, connect Google Drive and choose the company shared-drive task folder. The app stores task folders, uploaded originals, previews, comments, and metadata JSON files in that Drive folder.

Existing Drive work can be imported from inside the app with **Import from Drive**. The app uses Google Picker selection instead of broad Drive auto-scanning.

To force local-only mode for offline demos, set `VITE_USE_SHARED_DRIVE_DATA=false`.

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
