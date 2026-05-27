import { getInviteUsers, getSignupUrlForApp } from './inviteContent';

export { getInviteUsers };

export function getSignupUrl(email?: string) {
  if (typeof window === 'undefined') return '';
  return getSignupUrlForApp(new URL(window.location.pathname, window.location.origin).toString(), email);
}

export function getInviteMailto(email?: string) {
  const inviteUsers = getInviteUsers();
  const targetUsers = email ? inviteUsers.filter(user => user.email === email) : inviteUsers;
  const recipients = email || inviteUsers.map(user => user.email).join(',');
  const encodedRecipients = recipients
    .split(',')
    .map(recipient => encodeURIComponent(recipient.trim()))
    .join(',');
  const signupLines = targetUsers.length > 0
    ? targetUsers.map(user => `${user.name}: ${getSignupUrl(user.email)}`)
    : [getSignupUrl(email)];
  const subject = 'Access to National Care Approval Flow';
  const body = [
    targetUsers.length === 1 ? `Hi ${targetUsers[0].name},` : 'Hi Fawzy and Omar,',
    '',
    'You now have access to the National Care Approval Flow tool.',
    '',
    'Click your signup link below, enter your Gmail address, and create your own password:',
    ...signupLines,
    '',
    'After you create your password, sign in with your Gmail and your new password. The old demo password will stop working for your account.',
    '',
    'Thank you.',
  ].join('\n');

  return `mailto:${encodedRecipients}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
