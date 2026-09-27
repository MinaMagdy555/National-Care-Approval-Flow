<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# National Care Approval Flow

National Care Approval Flow is a React/Vite workspace for assigning, reviewing, approving, scheduling, and reporting creative work. It supports custom task workflows, role-based review queues, shared persistence through Neon or Google Drive, local offline mode, deadline reminders, daily reports, member administration, and campaign publishing schedules.

View your app in AI Studio: https://ai.studio/apps/fdc3e636-b24a-47be-8852-c36770cc3702

## Documentation Handoff

Send these files when handing off the project documentation:

- [`README.md`](README.md) for the project overview, local setup, workspace accounts, and deployment notes.
- [`docs/project-documentation.md`](docs/project-documentation.md) for the full architecture, domain model, persistence modes, API details, environment variables, and maintenance notes.
- [`docs/deadline-scheduler-deployment.md`](docs/deadline-scheduler-deployment.md) if the recipient will deploy or operate background deadline reminders and daily reports.

Do not send `.env.local`, production secrets, database URLs, SMTP app passwords, Supabase service-role keys, or cron secrets. Use `.env.example` when the recipient needs an environment-variable template.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Workspace Accounts

These are the final workspace accounts configured for this project. No email confirmation, external provider, or admin approval is required for these accounts.

| Account | Email | Password |
| --- | --- | --- |
| Mina M. Bashir | `Minamagdy5555@gmail.com` | `Mina.Bashir` (or `015594`) |
| Dina El-Alfy | `dina.mohamed.elalfy@gmail.com` | `Dina.Elalfy` |
| Marwa El-Kady | `marwa.elkady93@gmail.com` | `Marwa.Elkady` |
| Mariam Ezzat | `mariamezzat1755@gmail.com` | `Mariam.Ezaat` |
| Noreen Kamal | `noreen.kamel2031@gmail.com` | `Noreen.Kamal` |
| Yomna F. Amin | `yf.amin2@gmail.com` | `Yomna.F.Amin` |
| Reem Nabil | `reemnabil2002@gmail.com` | `Reem.Nabil` |
| Sama Moh. | `samamoh.SM@gmail.com` | `Sama.Moh.SM` |
| Haneen Haitham | `haneenhaitham757@gmail.com` | `Haneen. Haitham` |
| Omar Mansoour | `Omarmansoour96@gmail.com` | `Omar.Mansoour` |
| Ahmed Fawzy | `ahmed.mostafa.fawzy@gmail.com` | `Ahmed.Fawzy` |
| Ahmed Sobeeh | `ahmadsobeeh011129@gmail.com` | `Ahmed.Sobeeh` |

Fawzy and Omar can also use the invitation email flow to create their own passwords with their Gmail addresses. Once either one creates a password, that person's listed password stops working in that browser.

### Sending Invitation Emails

To send real invite emails to Fawzy and Omar, configure Gmail SMTP in `.env.local`:

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_USER="your-gmail-address@gmail.com"
SMTP_APP_PASSWORD="YOUR_GMAIL_APP_PASSWORD"
SMTP_FROM_NAME="National Care Approval Flow"
APP_URL="http://localhost:3000"
INVITE_ADMIN_COPY_EMAIL="minamagdy5555@gmail.com"
INVITE_SEND_SECRET="CHOOSE_A_PRIVATE_SEND_SECRET"
```

Use a Gmail app password for `SMTP_APP_PASSWORD`. After the variables are set, use the invite panel in the sign-in screen with `INVITE_SEND_SECRET`.

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

In Google Cloud, enable the Google Drive API and Google Picker API, create a web OAuth client, and add the deployed app origin to the OAuth client. After signing into a workspace account, connect Google Drive and choose the company shared-drive task folder. The app stores task folders, uploaded originals, previews, comments, and metadata JSON files in that Drive folder.

Existing Drive work can be imported from inside the app with **Import from Drive**. The app uses Google Picker selection instead of broad Drive auto-scanning.

To force local-only mode for offline use, set `VITE_USE_SHARED_DRIVE_DATA=false`.

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
