import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import https from 'https';
import { neon } from '@neondatabase/serverless';

function fetchUrlTitle(targetUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };

    try {
      const parsedUrl = new URL(targetUrl);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      };

      const cleanTitle = (rawTitle: string) => {
        let title = rawTitle.trim();
        title = title
          .replace(/\s*-\s*Google\s+Drive$/i, '')
          .replace(/\s*-\s*Google\s+Docs$/i, '')
          .replace(/\s*-\s*Google\s+Sheets$/i, '')
          .replace(/\s*-\s*Google\s+Slides$/i, '')
          .replace(/\s*-\s*Google\s+Forms$/i, '')
          .replace(/\s*-\s*Google\s+Drawings$/i, '');
        
        title = title
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'");
        return title;
      };

      https.get(options, (res) => {
        if (res.statusCode && (res.statusCode >= 300 && res.statusCode < 400) && res.headers.location) {
          fetchUrlTitle(res.headers.location).then(safeResolve);
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.includes('</title>')) {
            res.destroy();
            const match = data.match(/<title>(.*?)<\/title>/i);
            if (match) {
              safeResolve(cleanTitle(match[1]));
            } else {
              safeResolve(null);
            }
          }
        });

        res.on('end', () => {
          const match = data.match(/<title>(.*?)<\/title>/i);
          if (match) {
            safeResolve(cleanTitle(match[1]));
          } else {
            safeResolve(null);
          }
        });
      }).on('error', () => {
        safeResolve(null);
      });
    } catch {
      safeResolve(null);
    }
  });
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'metadata-scraper',
        configureServer(server) {
          server.middlewares.use('/api/app-state', async (req, res) => {
            const databaseUrl = env.DATABASE_URL;
            if (!databaseUrl) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'DATABASE_URL is not configured.' }));
              return;
            }

            try {
              const sql = neon(databaseUrl);
              await sql`
                CREATE TABLE IF NOT EXISTS app_state (
                  id text PRIMARY KEY,
                  state jsonb NOT NULL,
                  updated_at timestamptz NOT NULL DEFAULT now()
                )
              `;

              if (req.method === 'GET') {
                const rows = await sql`
                  SELECT state, updated_at
                  FROM app_state
                  WHERE id = 'current'
                  LIMIT 1
                `;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ state: rows[0]?.state || null, updatedAt: rows[0]?.updated_at || null }));
                return;
              }

              if (req.method === 'PUT') {
                let rawBody = '';
                req.on('data', chunk => {
                  rawBody += chunk;
                });
                req.on('end', async () => {
                  try {
                    const body = rawBody ? JSON.parse(rawBody) : null;
                    if (!body || typeof body !== 'object' || !('state' in body)) {
                      res.statusCode = 400;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: 'state is required' }));
                      return;
                    }

                    await sql`
                      INSERT INTO app_state (id, state, updated_at)
                      VALUES ('current', ${JSON.stringify(body.state)}::jsonb, now())
                      ON CONFLICT (id)
                      DO UPDATE SET state = EXCLUDED.state, updated_at = now()
                    `;
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: true }));
                  } catch (error) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown Neon error' }));
                  }
                });
                return;
              }

              res.statusCode = 405;
              res.setHeader('Allow', 'GET, PUT');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Method not allowed' }));
            } catch (error) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown Neon error' }));
            }
          });

          server.middlewares.use('/api/metadata', async (req, res) => {
            const urlObj = new URL(req.url || '', 'http://localhost');
            const targetUrl = urlObj.searchParams.get('url');
            if (!targetUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'url parameter is required' }));
              return;
            }
            try {
              const title = await fetchUrlTitle(targetUrl);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ title }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err) }));
            }
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
