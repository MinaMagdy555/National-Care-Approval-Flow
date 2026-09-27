import https from 'https';
import { createTaskMetadataAuthorizer } from '../server/taskMetadata.js';
import type { WorkspaceRequest } from '../server/workspaceAuth.js';

function permittedMetadataUrl(raw: string): boolean {
  try { const url = new URL(raw); return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname) && !url.port && !url.username && !url.password; }
  catch { return false; }
}

function fetchUrlTitle(targetUrl: string): Promise<string | null> {
  if (!permittedMetadataUrl(targetUrl)) return Promise.resolve(null);
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

export function createMetadataHandler(options: { authorize?: ReturnType<typeof createTaskMetadataAuthorizer>; fetchTitle?: typeof fetchUrlTitle; localPreview?: boolean } = {}) {
return async function handler(req: WorkspaceRequest, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const urlObj = new URL(req.url || '', 'http://localhost');
  const targetUrl = urlObj.searchParams.get('url');

  if (!targetUrl) {
    res.status(400).json({ error: 'url parameter is required' });
    return;
  }
  if (!permittedMetadataUrl(targetUrl)) { res.status(400).json({ error: 'Use a Google Drive or Google Docs link.' }); return; }

  try {
    if (!options.localPreview) {
      const status = await (options.authorize || createTaskMetadataAuthorizer())(req, targetUrl, urlObj.searchParams.get('taskId'));
      if (status !== 200) { res.status(status).json({ error: 'This task attachment is not available to this account.' }); return; }
    }
    const title = await (options.fetchTitle || fetchUrlTitle)(targetUrl);
    res.status(200).json({ title });
  } catch {
    res.status(503).json({ error: 'Attachment metadata is temporarily unavailable.' });
  }
}
}

export default createMetadataHandler();
