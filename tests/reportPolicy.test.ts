import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppSettings } from '../src/lib/appSettings';
import type { AppSettings, DailyReport, User } from '../src/lib/types';
import { canEditDailyReport, canViewDailyReport, getDailyReportReceiverIds, getReportSeniorId, getReportTeamKeys, isReportExempt } from '../src/lib/reportPolicy';

const member: User = { id: 'content-a', name: 'Content A', role: 'team_member', jobTitle: 'Content Creator' };
const peer: User = { ...member, id: 'content-b', name: 'Content B' };
const senior: User = { id: 'senior-content', name: 'Content Senior', role: 'team_member', jobTitle: 'Senior Content Creator' };
const productionSenior: User = { id: 'senior-production', name: 'Production Senior', role: 'reviewer', jobTitle: 'Senior Brand Designer & Video Editor', isAdmin: true };
const designer: User = { id: 'designer', name: 'Designer', role: 'team_member', jobTitle: 'Graphic Designer' };
const editor: User = { id: 'editor', name: 'Editor', role: 'team_member', jobTitle: 'Video Editor' };
const tl: User = { id: 'tl', name: 'Team Leader', role: 'team_leader' };
const ad: User = { id: 'ad', name: 'Art Director', role: 'art_director' };
const mm: User = { id: 'mm', name: 'Marketing Manager', role: 'marketing_manager' };
const users = [member, peer, senior, productionSenior, designer, editor, tl, ad, mm];
const settings: AppSettings = { ...defaultAppSettings, manualUsers: users, deletedMembers: [], reportingSeniorByUserId: {}, dailyReportReceiverUserIds: [peer.id, productionSenior.id] };
const sent = (userId: string) => ({ userId, sentAt: '2026-09-14T14:29:00.000Z' });

test('ordinary report reaches its own senior and leadership, never peers or unrelated seniors', () => {
  assert.deepEqual(getDailyReportReceiverIds(sent(member.id), settings, users), [senior.id, tl.id, ad.id, mm.id]);
  for (const viewer of [member, senior, tl, ad, mm]) assert.equal(canViewDailyReport(sent(member.id), viewer, settings, users), true);
  for (const viewer of [peer, productionSenior, designer]) assert.equal(canViewDailyReport(sent(member.id), viewer, settings, users), false);
});

test('senior reports go upward and senior admin tooling never permits peer reports', () => {
  assert.deepEqual(getDailyReportReceiverIds(sent(senior.id), settings, users), [tl.id, ad.id, mm.id]);
  assert.equal(canViewDailyReport(sent(senior.id), productionSenior, settings, users), false);
  assert.equal(canViewDailyReport(sent(productionSenior.id), senior, settings, users), false);
  assert.equal(canViewDailyReport(sent(productionSenior.id), designer, settings, users), false);
});

test('combined production senior supervises design and video using both title teams', () => {
  assert.deepEqual(getReportTeamKeys(productionSenior), ['Design Team', 'Video Team']);
  assert.equal(getReportSeniorId(designer, settings, users), productionSenior.id);
  assert.equal(getReportSeniorId(editor, settings, users), productionSenior.id);
  assert.equal(canViewDailyReport(sent(editor.id), productionSenior, settings, users), true);
});

test('team leader submits only upward; Art Director and Marketing Manager are exempt', () => {
  const secondTl: User = { ...tl, id: 'tl-peer' };
  assert.deepEqual(getDailyReportReceiverIds(sent(tl.id), settings, [...users, secondTl]), [ad.id, mm.id]);
  assert.equal(canViewDailyReport(sent(tl.id), secondTl, settings, [...users, secondTl]), false);
  assert.equal(isReportExempt(tl), false);
  assert.equal(canEditDailyReport(sent(tl.id), tl, settings), true);
  for (const leader of [ad, mm]) {
    assert.equal(isReportExempt(leader), true);
    assert.equal(canEditDailyReport(sent(leader.id), leader, settings), false);
  }
});

test('drafts remain personal even for the correct senior and leadership', () => {
  const draft = { userId: member.id, sentAt: null };
  assert.equal(canViewDailyReport(draft, member, settings, users), true);
  for (const viewer of [senior, tl, ad, mm]) assert.equal(canViewDailyReport(draft, viewer, settings, users), false);
});

test('inspection does not grant permission to change or send someone else’s report', () => {
  for (const actor of [senior, tl, ad, mm, peer]) assert.equal(canEditDailyReport(sent(member.id), actor, settings), false);
  assert.equal(canEditDailyReport(sent(member.id), member, settings), true);
});

test('ambiguous senior matching requires explicit assignment and never grants both seniors', () => {
  const second: User = { ...senior, id: 'second-senior' };
  const roster = [...users, second];
  assert.equal(getReportSeniorId(member, settings, roster), null);
  const configured = { ...settings, reportingSeniorByUserId: { [member.id]: second.id } };
  assert.equal(getReportSeniorId(member, configured, roster), second.id);
  assert.equal(canViewDailyReport(sent(member.id), senior, configured, roster), false);
  assert.equal(canViewDailyReport(sent(member.id), second, configured, roster), true);
});

test('explicit no-senior and invalid/deleted supervisor do not fall back or leak to peers', () => {
  for (const selected of [null, 'missing', peer.id, ad.id]) {
    const configured = { ...settings, reportingSeniorByUserId: { [member.id]: selected } };
    assert.equal(getReportSeniorId(member, configured, users), null);
    assert.deepEqual(getDailyReportReceiverIds(sent(member.id), configured, users), [tl.id, ad.id, mm.id]);
  }
  const removed = { ...settings, deletedMembers: [{ ...senior, deletedAt: '2026-09-14', deletedBy: ad.id }] };
  assert.equal(getReportSeniorId(member, removed, users), null);
  assert.equal(canViewDailyReport(sent(member.id), senior, removed, users), false);
});

test('unknown job titles and names cannot accidentally infer team access', () => {
  const unknown: User = { id: 'unknown', name: 'Content Designer', role: 'team_member', jobTitle: 'Coordinator' };
  assert.deepEqual(getReportTeamKeys(unknown), []);
  assert.equal(getReportSeniorId(unknown, settings, [...users, unknown]), null);
});

test('guests and removed members cannot read their own cached report', () => {
  const guest: User = { id: 'guest', name: 'Guest', role: 'team_member' };
  assert.equal(canViewDailyReport(sent('guest'), guest, settings, users), false);
  const removed = { ...settings, deletedMembers: [{ ...member, deletedAt: '2026-09-14', deletedBy: ad.id }] };
  assert.equal(canViewDailyReport(sent(member.id), member, removed, users), false);
  assert.equal(canEditDailyReport(sent(member.id), member, removed), false);
});

test('leadership can still inspect submitted historical reports of removed authors', () => {
  const removed = { ...settings, deletedMembers: [{ ...member, deletedAt: '2026-09-14', deletedBy: ad.id }] };
  assert.equal(canViewDailyReport(sent(member.id), ad, removed, users.filter(user => user.id !== member.id)), true);
});
