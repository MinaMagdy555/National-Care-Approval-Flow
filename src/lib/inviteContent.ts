import { initialUsers } from './mockData';
import type { User } from './types';

export const INVITE_USER_IDS = ['user_7', 'user_8'];
export const DEFAULT_INVITE_ADMIN_COPY_EMAIL = 'minamagdy5555@gmail.com';

export type InviteUser = User & { email: string };

export type InviteEmailMessage = {
  to: string;
  cc: string[];
  subject: string;
  text: string;
  html: string;
};

export function getInviteUsers() {
  return INVITE_USER_IDS
    .map(userId => initialUsers.find(user => user.id === userId))
    .filter((user): user is InviteUser => Boolean(user?.email));
}

export function getSignupUrlForApp(appUrl: string, email?: string) {
  const url = new URL(appUrl);
  url.searchParams.set('view', 'sign_in');
  url.searchParams.set('signup', '1');
  if (email) url.searchParams.set('email', email);
  return url.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildInviteEmail(user: InviteUser, appUrl: string, copyEmail = DEFAULT_INVITE_ADMIN_COPY_EMAIL): InviteEmailMessage {
  const signupUrl = getSignupUrlForApp(appUrl, user.email);
  const subject = 'Access to National Care Approval Flow';
  const text = [
    `Hi ${user.name},`,
    '',
    'You now have access to the National Care Approval Flow tool.',
    '',
    'Click the link below, enter your Gmail address, and create your own password:',
    signupUrl,
    '',
    'After you create your password, sign in with your Gmail and your new password. The old demo password will stop working for your account.',
    '',
    'Thank you.',
  ].join('\n');

  const safeName = escapeHtml(user.name);
  const safeSignupUrl = escapeHtml(signupUrl);

  return {
    to: user.email,
    cc: copyEmail ? [copyEmail] : [],
    subject,
    text,
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:560px">',
      `<p>Hi ${safeName},</p>`,
      '<p>You now have access to the <strong>National Care Approval Flow</strong> tool.</p>',
      '<p>Click the button below, enter your Gmail address, and create your own password.</p>',
      `<p><a href="${safeSignupUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 18px">Create Password</a></p>`,
      `<p style="font-size:13px;color:#475569">If the button does not open, copy this link:<br><a href="${safeSignupUrl}">${safeSignupUrl}</a></p>`,
      '<p style="font-size:13px;color:#475569">After you create your password, sign in with your Gmail and your new password. The old demo password will stop working for your account.</p>',
      '<p>Thank you.</p>',
      '</div>',
    ].join(''),
  };
}

export function buildInviteEmails(appUrl: string, copyEmail = DEFAULT_INVITE_ADMIN_COPY_EMAIL) {
  return getInviteUsers().map(user => buildInviteEmail(user, appUrl, copyEmail));
}
