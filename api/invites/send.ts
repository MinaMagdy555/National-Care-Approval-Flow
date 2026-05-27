import { sendInviteEmails } from '../../src/lib/inviteEmailServer';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => { json: (value: unknown) => void; end: () => void };
  setHeader: (name: string, value: string) => void;
};

function getHeader(headers: ApiRequest['headers'], name: string) {
  const normalizedName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not send invitation emails.';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedSecret = process.env.INVITE_SEND_SECRET?.trim();
  if (!expectedSecret) {
    res.status(500).json({ error: 'INVITE_SEND_SECRET is not configured.' });
    return;
  }

  const providedSecret = getHeader(req.headers, 'x-invite-send-secret')?.trim();
  if (!providedSecret || providedSecret !== expectedSecret) {
    res.status(401).json({ error: 'Invalid invite send secret.' });
    return;
  }

  try {
    const sent = await sendInviteEmails();
    res.status(200).json({ sent });
  } catch (error) {
    res.status(500).json({ error: getErrorMessage(error) });
  }
}
