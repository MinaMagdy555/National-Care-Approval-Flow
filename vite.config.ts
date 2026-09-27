import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { createMetadataHandler } from './api/metadata';
import { createTaskMetadataAuthorizer } from './server/taskMetadata';
import { neon } from '@neondatabase/serverless';
import { createAppStateHandler } from './api/app-state';
import { createWorkspaceAuth } from './server/workspaceAuth';
import { createDeadlineReminderHandler } from './api/cron/deadline-reminders';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'metadata-scraper',
        configureServer(server) {
          const appStateHandler = createAppStateHandler(() => {
            if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
            return neon(env.DATABASE_URL);
          }, createWorkspaceAuth({ env }));
          const deadlineHandler = createDeadlineReminderHandler({ env, sqlFactory: () => {
            if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
            return neon(env.DATABASE_URL);
          } });
          server.middlewares.use('/api/cron/deadline-reminders', async (req, res) => {
            await deadlineHandler({ method: req.method, headers: req.headers }, {
              setHeader: (name, value) => { res.setHeader(name, value); },
              status: code => { res.statusCode = code; return { json: value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); } }; },
            });
          });
          server.middlewares.use('/api/app-state', async (req, res) => {
            let body = '';
            try {
              for await (const chunk of req) body += chunk.toString();
              await appStateHandler({ method: req.method, url: req.url, headers: req.headers, body: body || undefined }, {
                setHeader: (name, value) => { res.setHeader(name, value); },
                status: code => {
                  res.statusCode = code;
                  return {
                    json: value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); },
                    end: () => { res.end(); },
                  };
                },
              });
            } catch {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Could not read the app-state request.' }));
            }
          });

          const metadataHandler = createMetadataHandler({
            localPreview: !['1', 'true', 'yes', 'on'].includes(String(env.VITE_USE_NEON_DATA || '').toLowerCase()),
            authorize: createTaskMetadataAuthorizer(() => {
              if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
              return neon(env.DATABASE_URL);
            }, createWorkspaceAuth({ env })),
          });
          server.middlewares.use('/api/metadata', async (req, res) => {
            await metadataHandler({ method: req.method, url: req.url, headers: req.headers }, {
              setHeader: (name: string, value: string) => { res.setHeader(name, value); },
              status: (code: number) => { res.statusCode = code; return { json: (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); } }; },
            });
          });
        }
      }
    ],
    base: env.VITE_BASE_PATH || '/',
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
