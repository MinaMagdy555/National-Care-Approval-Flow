import * as nodemailer from 'nodemailer';
import { buildInviteEmails, DEFAULT_INVITE_ADMIN_COPY_EMAIL } from './inviteContent';

type InviteEmailEnv = {
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_APP_PASSWORD?: string;
  SMTP_FROM_NAME?: string;
  APP_URL?: string;
  INVITE_ADMIN_COPY_EMAIL?: string;
};

export type SentInviteEmail = {
  to: string;
  cc: string[];
  messageId?: string;
};

function requireEnvValue(env: InviteEmailEnv, key: keyof InviteEmailEnv) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required to send invitation emails.`);
  return value;
}

function getInviteEmailConfig(env: InviteEmailEnv = process.env) {
  const smtpHost = env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const smtpPortValue = env.SMTP_PORT?.trim() || '465';
  const smtpPort = Number.parseInt(smtpPortValue, 10);
  if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
    throw new Error('SMTP_PORT must be a valid port number.');
  }

  return {
    smtpHost,
    smtpPort,
    smtpUser: requireEnvValue(env, 'SMTP_USER'),
    smtpPassword: requireEnvValue(env, 'SMTP_APP_PASSWORD'),
    fromName: env.SMTP_FROM_NAME?.trim() || 'National Care Approval Flow',
    appUrl: requireEnvValue(env, 'APP_URL'),
    copyEmail: env.INVITE_ADMIN_COPY_EMAIL?.trim() || DEFAULT_INVITE_ADMIN_COPY_EMAIL,
  };
}

export function assertInviteEmailConfig(env: InviteEmailEnv = process.env) {
  getInviteEmailConfig(env);
}

export async function sendInviteEmails(env: InviteEmailEnv = process.env): Promise<SentInviteEmail[]> {
  const config = getInviteEmailConfig(env);
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });

  const messages = buildInviteEmails(config.appUrl, config.copyEmail);
  const from = `${config.fromName} <${config.smtpUser}>`;
  const sent: SentInviteEmail[] = [];

  for (const message of messages) {
    const info = await transporter.sendMail({
      from,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    sent.push({
      to: message.to,
      cc: message.cc,
      messageId: info.messageId,
    });
  }

  return sent;
}
