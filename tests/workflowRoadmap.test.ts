import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppSettings } from '../src/lib/appSettings';
import { canSeeWorkflowRoadmap, getWorkflowRoadmap, formatUserLabel, formatGroupedOwners } from '../src/lib/workflowRoadmap';
import type { Task, User, WorkflowDefinition } from '../src/lib/types';

const usersList: User[] = [
  {id:'a',name:'A',role:'team_member'},
  {id:'b',name:'B',role:'team_member',jobTitle:'Brand Designer'},
  {id:'lead',name:'New leader',role:'team_leader'},
  {id:'senior',name:'Senior',role:'reviewer',jobTitle:'Senior Reviewer'},
  {id:'ad',name:'AD',role:'art_director'},
  {id:'other-ad',name:'Other AD',role:'art_director'}
];
const users = Object.fromEntries(usersList.map(u => [u.id, u]));

const phase = (id: string, owners: string[], mode: 'sequential'|'parallel' = 'sequential', parentPhaseIds: string[] = ['workflow-root']) => ({
  id, name: id, phaseKind: 'work' as const, reviewStyle: 'first_review' as const, mode, userIds: owners, roleIds: [], responsibilityIds: [], parentPhaseIds
});

const workflow: WorkflowDefinition = {
  id: 'saved', name: 'Saved workflow', active: true, phases: [
    phase('P2', ['b'], 'sequential', ['P1']),
    phase('P3', ['senior'], 'sequential', ['P2']),
    phase('P1', ['a', 'b'], 'sequential', ['workflow-root']), // shuffled out of order intentionally
    {...phase('Final Rev.', ['ad'], 'sequential', ['P3']), phaseKind: 'final_review', roleIds: ['art_director']}
  ]
};

const settings = mergeAppSettings({manualUsers: usersList, finalReviewerUserIds: ['other-ad'], workflows: []});

const base = {
  id: 'roadmap', name: 'Roadmap', createdBy: 'lead', handledBy: ['a','b'], status: 'assigned_work', versions: [], comments: [],
  workflowSnapshot: workflow, workflowActivePhaseIds: ['P1'], workflowCurrentPhaseId: 'P1', currentOwnerUserIds: ['a'],
  workflowPhaseApprovals: {}, workflowFinalApproverIdsByPhaseId: {'Final Rev.': 'ad'}, workflowPhaseHistory: []
} as unknown as Task;

test('each parallel branch retains its exact pending owner, with sequential approvals and saved names', () => {
  const task = {
    ...base,
    workflowSnapshot: {
      ...workflow,
      phases: [
        phase('Branch A', ['a', 'b'], 'sequential'),
        phase('Branch B', ['senior'], 'parallel')
      ]
    },
    workflowActivePhaseIds: ['Branch A', 'Branch B'],
    workflowPhaseApprovals: {'Branch A': ['a']}
  } as unknown as Task;

  const roadmap = getWorkflowRoadmap(task, settings, usersList);
  assert.deepEqual(roadmap.map(s => [s.name, s.ownerIds]), [['Branch A', ['b']], ['Branch B', ['senior']]]);

  const parallel = structuredClone(task);
  parallel.workflowSnapshot!.phases[0].mode = 'parallel';
  parallel.workflowPhaseApprovals = {};
  const parallelRoadmap = getWorkflowRoadmap(parallel, settings, usersList);
  assert.deepEqual(parallelRoadmap[0].ownerIds, ['a', 'b']);
});

test('delayed and held steps retain responsibility without claiming an available action', () => {
  const task = {...base, workflowPhaseAvailableAtByPhaseId: {'P1': '2026-10-01T00:00:00Z'}};
  assert.equal(getWorkflowRoadmap(task, settings, usersList, new Date('2026-09-15'))[0].state, 'Scheduled');
  assert.deepEqual(getWorkflowRoadmap(task, settings, usersList, new Date('2026-09-15'))[0].ownerIds, ['a']);
  assert.ok(getWorkflowRoadmap({...task, status: 'on_hold'}, settings, usersList).every(s => s.state === 'On hold' || s.state === 'Pending'));
});

test('final roadmap uses frozen AD and closed tasks have no waiting owner', () => {
  const task = {...base, workflowActivePhaseIds: ['Final Rev.']};
  const roadmap = getWorkflowRoadmap(task, settings, usersList);
  assert.deepEqual(roadmap.find(s => s.id === 'Final Rev.')?.ownerIds, ['ad']);

  for (const status of ['completed', 'archived', 'approved_by_art_director'] as const) {
    const closedTask = {...task, status};
    assert.ok(getWorkflowRoadmap(closedTask, settings, usersList).every(s => s.ownerIds.length === 0 && !s.isActive && s.state !== 'Finished'));
  }
});

test('returned legacy review shows actual revision owner', () => {
  const task = {
    ...base,
    status: 'changes_requested_by_art_director',
    workflowActivePhaseIds: ['Final Rev.'],
    currentOwnerUserIds: ['b']
  } as unknown as Task;
  const roadmap = getWorkflowRoadmap(task, settings, usersList);
  assert.deepEqual(roadmap.find(s => s.id === 'Final Rev.')?.ownerIds, ['b']);
});

test('every authorized employee sees the roadmap while future employees cannot see the task', () => {
  assert.equal(canSeeWorkflowRoadmap(base, users['lead'], settings, usersList), true);
  const seniorTask = {...base, currentOwnerUserIds: ['senior'], workflowNodeAssigneeIds: {'P1': ['senior']}} as unknown as Task;
  assert.equal(canSeeWorkflowRoadmap(seniorTask, users['senior'], settings, usersList), true);
  assert.equal(canSeeWorkflowRoadmap(base, users['a'], settings, usersList), true);
  assert.equal(canSeeWorkflowRoadmap(base, users['b'], settings, usersList), false);
});

test('topological sort orders steps correctly despite shuffled definition order', () => {
  const roadmap = getWorkflowRoadmap(base, settings, usersList);
  assert.deepEqual(roadmap.map(s => s.id), ['P1', 'P2', 'P3', 'Final Rev.']);
});

test('history semantics correctly determine completed state', () => {
  // P1 completed, P2 started, then P2 invalidated and P1 reopened, then P1 completed again
  const task = {
    ...base,
    workflowActivePhaseIds: ['P2'],
    workflowPhaseHistory: [
      { phaseId: 'P1', phaseName: 'P1', action: 'completed', actorId: 'a', createdAt: '2026-09-27T08:00:00Z' },
      { phaseId: 'P2', phaseName: 'P2', action: 'completed', actorId: 'b', createdAt: '2026-09-27T09:00:00Z' },
      { phaseId: 'P2', phaseName: 'P2', action: 'invalidated', actorId: 'senior', createdAt: '2026-09-27T10:00:00Z' },
      { phaseId: 'P1', phaseName: 'P1', action: 'started', actorId: 'senior', createdAt: '2026-09-27T10:00:00Z' },
      { phaseId: 'P1', phaseName: 'P1', action: 'completed', actorId: 'a', createdAt: '2026-09-27T11:00:00Z' }
    ]
  } as unknown as Task;
  const roadmap = getWorkflowRoadmap(task, settings, usersList);
  assert.equal(roadmap.find(s => s.id === 'P1')?.state, 'Finished');
  assert.equal(roadmap.find(s => s.id === 'P2')?.state, 'Current'); // Since active
});

test('formatUserLabel applies correct job titles and fallbacks', () => {
  assert.equal(formatUserLabel(users['a']), 'Content Creator · A');
  assert.equal(formatUserLabel(users['b']), 'Brand Designer · B');
  assert.equal(formatUserLabel(users['senior']), 'Senior Reviewer · Senior');
  assert.equal(formatUserLabel(users['ad']), 'Art Director · AD');
  assert.equal(formatUserLabel(undefined), 'Unavailable member');
});

test('only completed steps fill as the task passes through three employees; reopening clears the fill', () => {
  const completed = (id: string) => ({ phaseId: id, phaseName: id, action: 'completed' as const, actorId: 'a', createdAt: '2026-09-27T08:00:00Z' });
  for (let turn = 1; turn <= 3; turn++) {
    const task = { ...base, workflowActivePhaseIds: [`P${turn}`], workflowPhaseHistory: Array.from({ length: turn - 1 }, (_, i) => completed(`P${i + 1}`)) };
    assert.deepEqual(getWorkflowRoadmap(task, settings, usersList).map(step => step.state),
      Array.from({ length: 4 }, (_, i) => i < turn - 1 ? 'Finished' : i === turn - 1 ? 'Current' : 'Pending'));
  }
  const returned = { ...base, workflowPhaseHistory: [completed('P1'), completed('P2'), { ...completed('P2'), action: 'invalidated' as const }, { ...completed('P1'), action: 'started' as const }] };
  assert.deepEqual(getWorkflowRoadmap(returned, settings, usersList).map(step => step.state), ['Current', 'Pending', 'Pending', 'Pending']);
  const partial = { ...base, workflowActivePhaseIds: ['P2'], workflowPhaseHistory: [{ ...completed('P1'), action: 'approved' as const }], workflowPhaseApprovals: { P1: ['a'] } };
  assert.equal(getWorkflowRoadmap(partial, settings, usersList)[0].state, 'Pending');
});

test('implicit skipped history stays unfilled and legacy forward edges retain their order', () => {
  const task = structuredClone(base);
  task.workflowSnapshot!.phases = [phase('last', ['b'], 'sequential', []), phase('first', ['a'], 'sequential', []), { ...phase('note', [], 'sequential', []), nodeType: 'note' }];
  task.workflowSnapshot!.phases[1].passToPhaseId = 'last';
  task.workflowPhaseHistory = [{ phaseId: 'first', phaseName: 'first', action: 'skipped', actorId: 'lead', createdAt: '2026-09-27T08:00:00Z' }];
  task.workflowActivePhaseIds = ['last'];
  assert.deepEqual(getWorkflowRoadmap(task, settings, usersList).map(step => [step.id, step.state]), [['first', 'Skipped'], ['last', 'Current']]);
  task.workflowSnapshot!.phases[1].passToPhaseId = null;
  task.workflowSnapshot!.phases[0].parentPhaseId = 'first';
  assert.deepEqual(getWorkflowRoadmap(task, settings, usersList).map(step => step.id), ['first', 'last']);
});

test('skipped and disabled phases are distinct', () => {
  const task = {
    ...base,
    workflowSkippedPhaseIds: ['P2'],
    workflowSnapshot: {
      ...workflow,
      phases: workflow.phases.map(p => p.id === 'P3' ? {...p, disabled: true} : p)
    }
  } as unknown as Task;
  const roadmap = getWorkflowRoadmap(task, settings, usersList);
  assert.equal(roadmap.find(s => s.id === 'P2')?.state, 'Skipped');
  assert.equal(roadmap.find(s => s.id === 'P3')?.state, 'Disabled');
});

test('legacy progress fills proven predecessors but not unrelated branches or reopened work', () => {
  const legacy = {...base,workflowActivePhaseIds:['P3'],workflowCurrentPhaseId:'P3'};
  assert.deepEqual(getWorkflowRoadmap(legacy,settings,usersList).map(p=>p.state),['Finished','Finished','Current','Pending']);
  const migrated = {...legacy,workflowPhaseHistory:[{phaseId:'P1',phaseName:'P1',action:'workflow_changed' as const,actorId:'lead',createdAt:new Date().toISOString()}]};
  assert.deepEqual(getWorkflowRoadmap(migrated,settings,usersList).map(p=>p.state),['Finished','Finished','Current','Pending']);
  const branch = structuredClone(legacy);
  branch.workflowSnapshot!.phases.push(phase('Unrelated',['b']));
  assert.equal(getWorkflowRoadmap(branch,settings,usersList).find(p=>p.id==='Unrelated')?.state,'Pending');
  branch.workflowPhaseHistory=[{phaseId:'P2',phaseName:'P2',action:'invalidated',actorId:'senior',createdAt:new Date().toISOString()}];
  assert.equal(getWorkflowRoadmap(branch,settings,usersList).find(p=>p.id==='P2')?.state,'Pending');
  const finished={...base,workflowActivePhaseIds:[],workflowPhaseHistory:[{phaseId:'P3',phaseName:'P3',action:'completed' as const,actorId:'senior',createdAt:new Date().toISOString()}]};
  assert.deepEqual(getWorkflowRoadmap(finished,settings,usersList).slice(0,3).map(p=>p.state),['Finished','Finished','Finished']);
});

test('pass-only merges never imply that both possible predecessor branches completed', () => {
  const task = structuredClone(base);
  task.workflowSnapshot!.phases=[{...phase('left',['a']),passToPhaseId:'merge'},{...phase('right',['b']),passToPhaseId:'merge'},phase('merge',['senior'],'sequential',[])];
  task.workflowActivePhaseIds=['merge'];
  assert.deepEqual(getWorkflowRoadmap(task,settings,usersList).map(p=>p.state),['Pending','Pending','Current']);
});

test('owners share one title label while distinct titles and employee identities remain visible', () => {
  const roster={...users,c:{id:'c',name:'C',role:'team_member' as const,jobTitle:' content creator '}};
  assert.equal(formatGroupedOwners(['a','c','a','b'],roster),'Content Creator · A, C | Brand Designer · B');
  assert.equal(formatGroupedOwners([],roster),'No member assigned');
});
