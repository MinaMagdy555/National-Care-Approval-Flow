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
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
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
