import dotenv from 'dotenv';
import { sendInviteEmails } from '../src/lib/inviteEmailServer';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

async function main() {
  const sent = await sendInviteEmails();
  console.log(`Sent ${sent.length} invitation email${sent.length === 1 ? '' : 's'}.`);
  sent.forEach(message => {
    const copyText = message.cc.length > 0 ? `, copied ${message.cc.join(', ')}` : '';
    console.log(`- ${message.to}${copyText}`);
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Could not send invitation emails.');
  process.exitCode = 1;
});
