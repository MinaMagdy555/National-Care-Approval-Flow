import https from 'https';

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

export default async function handler(req: any, res: any) {
  const urlObj = new URL(req.url || '', 'http://localhost');
  const targetUrl = urlObj.searchParams.get('url');

  if (!targetUrl) {
    res.status(400).json({ error: 'url parameter is required' });
    return;
  }

  try {
    const title = await fetchUrlTitle(targetUrl);
    res.status(200).json({ title });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
