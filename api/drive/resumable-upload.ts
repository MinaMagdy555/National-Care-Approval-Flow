export default async function handler(req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, res: {
  status: (code: number) => { json: (value: unknown) => void; end: () => void };
  setHeader: (name: string, value: string) => void;
}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Google access token' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body as {
    metadata?: Record<string, unknown>;
    contentType?: string;
  } | undefined;

  if (!body?.metadata || !body.contentType) {
    res.status(400).json({ error: 'metadata and contentType are required' });
    return;
  }

  const driveResponse = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,parents,webViewLink,webContentLink,thumbnailLink,appProperties,createdTime,modifiedTime',
    {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': body.contentType,
      },
      body: JSON.stringify(body.metadata),
    }
  );

  const uploadUrl = driveResponse.headers.get('location');
  if (!driveResponse.ok || !uploadUrl) {
    let message = driveResponse.statusText;
    try {
      const errorBody = await driveResponse.json() as { error?: { message?: string } };
      message = errorBody.error?.message || message;
    } catch {
      // Keep status text.
    }
    res.status(driveResponse.status || 502).json({ error: message });
    return;
  }

  res.status(200).json({ uploadUrl });
}

