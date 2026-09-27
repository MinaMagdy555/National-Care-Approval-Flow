import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppSettings, isDeadlineInsideBusinessHours } from '../src/lib/appSettings';
import { canViewTaskDeadline, formatDeadlineInput, getTaskDeadlineAt, parseDeadlineInput, planDeadlineReminders, preserveDeadlineState, projectDeadlineNotifications } from '../src/lib/deadlinePolicy';
import type { Task, User, WorkflowPhaseDefinition } from '../src/lib/types';

const member = { id: 'writer', name: 'Writer', role: 'team_member', jobTitle: 'Content Creator' } as User;
const future = { ...member, id: 'future' };
const senior = { id: 'senior', name: 'Senior', role: 'reviewer', jobTitle: 'Senior Content Creator' } as User;
const peerAdmin = { id: 'design', name: 'Design senior', role: 'reviewer', jobTitle: 'Senior Brand Designer', isAdmin: true } as User;
const leader = { id: 'ad', name: 'AD', role: 'art_director' } as User;
const users = [member, future, senior, peerAdmin, leader];
const settings = mergeAppSettings({ manualUsers: users, workflows: [], reportingSeniorByUserId: { writer: senior.id, future: senior.id } });
const now = new Date('2026-09-14T08:00:00Z');
const phase = (id: string): WorkflowPhaseDefinition => ({ id, name: id, phaseKind: 'work', userIds: [], mode: 'parallel', reviewStyle: 'quick_look', roleIds: [], responsibilityIds: [], skipRule: 'none' });
const task = (override: Partial<Task> = {}): Task => ({ id: 'task', code: 'TSK-1', name: 'A task', status: 'assigned_work', createdBy: future.id,
  currentOwnerUserId: member.id, currentOwnerUserIds: [member.id], deadlineAt: '2026-09-15T08:00:00Z', deadlineText: null,
  workflowSnapshot: { id: 'flow', name: 'Flow', phases: [phase('work'), phase('future')] }, workflowActivePhaseIds: ['work'],
  workflowCurrentPhaseId: 'work', workflowNodeAssigneeIds: { work: [member.id], future: [future.id] }, ...override } as Task);

test('deadline parsing is absolute, strict and Cairo-aware across summer/winter and legacy dates', () => {
  assert.equal(parseDeadlineInput('2026-09-14T11:00')?.toISOString(), now.toISOString());
  assert.equal(parseDeadlineInput('2026-01-14T11:00')?.toISOString(), '2026-01-14T09:00:00.000Z');
  assert.equal(formatDeadlineInput(now), '2026-09-14T11:00');
  assert.equal(getTaskDeadlineAt({ deadlineAt: '2026-09-14t08:00:00z', deadlineText: null })?.toISOString(), now.toISOString());
  for (const value of ['tomorrow', '9/14/26', '2026-02-30T12:00:00Z', '2026-02-30T12:00:00+03:00', '2026-09-14T24:00:00Z', '2026-09-14T12:60:00Z', '2026-09-14T12:00:60Z']) {
    assert.equal(getTaskDeadlineAt({ deadlineAt: value, deadlineText: null }), null, value);
  }
  assert.equal(getTaskDeadlineAt({ deadlineAt: null, deadlineText: '2026-09-14' })?.toISOString(), '2026-09-14T20:59:00.000Z');
  assert.equal(isDeadlineInsideBusinessHours({ ...settings, businessCalendar: { ...settings.businessCalendar, workdays: [1], startTime: '10:00', endTime: '12:00' } }, now.toISOString(), new Date('2026-09-14T07:00:00Z')).ok, true);
});

test('deadline audience contains only active available owners, their senior and leadership; admin seniors stay scoped', () => {
  assert.deepEqual(users.filter(user => canViewTaskDeadline(task(), user, settings, users, now)).map(user => user.id), [member.id, senior.id, leader.id]);
  const delayed = task({ workflowPhaseAvailableAtByPhaseId: { work: '2026-09-14T09:00:00Z' } });
  assert.deepEqual(users.filter(user => canViewTaskDeadline(delayed, user, settings, users, now)).map(user => user.id), [leader.id]);
  const returned = task({ status: 'changes_requested_by_reviewer', currentOwnerUserId: future.id, currentOwnerUserIds: [future.id] });
  assert.equal(canViewTaskDeadline(returned, member, settings, users, now), false);
  assert.equal(canViewTaskDeadline(returned, future, settings, users, now), true);
  assert.equal(canViewTaskDeadline(task({ workflowNodeAssigneeIds: { work: [] } }), member, settings, users, now), false);
});

test('24h and 1h receipts survive notification clearing, repeated ticks and deadline edits', () => {
  const first = planDeadlineReminders([task()], settings, users, now);
  assert.equal(first.notifications.length, 3);
  assert.ok(first.notifications.every(item => item.deadlineReminder?.hours === 24));
  assert.equal(planDeadlineReminders(first.tasks, settings, users, now).notifications.length, 0);
  const hour = planDeadlineReminders(first.tasks, settings, users, new Date('2026-09-15T07:00:00Z'));
  assert.equal(hour.notifications.length, 3);
  assert.ok(hour.notifications.every(item => item.deadlineReminder?.hours === 1));
  assert.equal(planDeadlineReminders(hour.tasks, settings, users, new Date('2026-09-15T07:30:00Z')).notifications.length, 0);
  const edited = hour.tasks.map(item => ({ ...item, deadlineAt: '2026-09-15T09:00:00Z' }));
  assert.equal(planDeadlineReminders(edited, settings, users, new Date('2026-09-15T08:10:00Z')).notifications.length, 3);
});

test('missed windows never create obsolete 24h notices; closed, archived, overdue and missing deadlines do not send', () => {
  const late = planDeadlineReminders([task()], settings, users, new Date('2026-09-15T07:30:00Z'));
  assert.equal(late.notifications.length, 3);
  assert.ok(late.notifications.every(item => item.deadlineReminder?.hours === 1 && !item.message.includes('24 hours')));
  const excluded = [task({ status: 'completed' }), task({ archivedAt: now.toISOString() }), task({ deadlineAt: now.toISOString() }), task({ deadlineAt: null, deadlineText: 'soon' })];
  assert.equal(planDeadlineReminders(excluded, settings, users, now).notifications.length, 0);
});

test('stale clients cannot remove receipts/notices or forge recipients; reads recheck deadline and current audience', () => {
  const generated = planDeadlineReminders([task()], settings, users, now);
  const merged = preserveDeadlineState(generated.tasks, [task({ name: 'New edit' })], generated.notifications, [{ ...generated.notifications[0], id: 'deadline:forged', userId: future.id }], member);
  assert.equal(merged.tasks[0].name, 'New edit');
  assert.deepEqual(merged.tasks[0].deadlineReminderReceipts, generated.tasks[0].deadlineReminderReceipts);
  assert.deepEqual(merged.notifications, generated.notifications);
  assert.equal(projectDeadlineNotifications(merged.notifications, merged.tasks, member, settings, users, now).length, 1);
  assert.equal(projectDeadlineNotifications(merged.notifications, merged.tasks, future, settings, users, now).length, 0);
  assert.equal(projectDeadlineNotifications(merged.notifications, [task({ deadlineAt: '2026-09-16T08:00:00Z' })], member, settings, users, now).length, 0);
});
