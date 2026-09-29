import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppSettings } from '../src/lib/appSettings';
import { appendStartedEntries, computeWorkflowAdvance, computeWorkflowInitialization, computeWorkflowReturn } from '../src/lib/workflowRuntime';
import { getCurrentOwnerUserIds, getPhaseOwnerRole, getStatusForWorkflowPhase, resolveWorkflowPhaseOwnerIds } from '../src/lib/workflowUtils';
import { validateWorkflowGraph } from '../src/lib/workflowGraph';
import { getHandoffNotifications } from '../src/lib/reassignmentNotifications';
import { getWorkflowRoadmap } from '../src/lib/workflowRoadmap';
import { canViewTask } from '../src/lib/taskPolicy';
import { getStatusInfo } from '../src/lib/taskUtils';
import { mergeAuthorizedTasks } from '../server/taskAccess';
import type { Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from '../src/lib/types';

const users: User[] = [
  {id:'dina',name:'Dina',role:'team_leader'},
  {id:'samar',name:'Samar',role:'team_member'},
  {id:'sama',name:'Sama',role:'team_member'},
  {id:'mariam',name:'Mariam',role:'team_member'},
  {id:'mina',name:'Mina',role:'reviewer'},
  {id:'marwa',name:'Marwa',role:'art_director'},
];
const ownerIds = ['samar','sama','mariam','mina','marwa','sama'];
const names = ['Content','Senior Content Rev','Designer','Senior Brand Rev','Final Rev','Publishing'];
const kinds: WorkflowPhaseDefinition['phaseKind'][] = ['work','content_review','work','first_review','final_review','work'];
const workflow: WorkflowDefinition = {id:'banner',name:'Banner Design',active:true,taskTypeIds:['banner design'],phases:names.map((name,i)=>({
  id:`step${i+1}`,name,phaseKind:kinds[i],reviewStyle:i===4?'final_review':'first_review',mode:'sequential',userIds:[ownerIds[i]],
  roleIds:i===4?['art_director']:[],responsibilityIds:[],parentPhaseIds:[i?`step${i}`:'workflow-root'],
  isReviewDecision:[1,3,4].includes(i),passToPhaseId:i<5?`step${i+2}`:null,
  failToPhaseId:i===1?'step1':[3,4].includes(i)?'step3':null,
  returnToPhaseId:i===1?'step1':[3,4].includes(i)?'step3':null,
}))};
const settings=mergeAppSettings({workflows:[workflow],manualUsers:users,finalReviewerUserIds:['marwa'],notificationResetVersion:3});
function begin():Task {
  const now=new Date().toISOString();
  const task={id:'banner-test',code:'BANNER',name:'Banner Design test',taskType:'banner design',reviewMode:'first_review',environment:'production',
    createdBy:'dina',handledBy:ownerIds,workContributorIds:ownerIds,priority:'normal',status:'assigned_work',versions:[],comments:[],assignmentLinks:[],
    thumbnailUrl:'',deadlineText:null,createdAt:now,updatedAt:now,workflowId:workflow.id,workflowSnapshot:structuredClone(workflow),
    workflowNodeAssigneeIds:Object.fromEntries(workflow.phases.map((p,i)=>[p.id,[ownerIds[i]]])),workflowFinalApproverIdsByPhaseId:{step5:'marwa'},
    workflowPhaseApprovals:{},workflowSkippedPhaseIds:[],workflowActivePhaseIds:['step1'],workflowCurrentPhaseId:'step1',
    currentOwnerRole:'team_member',currentOwnerUserId:'samar',currentOwnerUserIds:['samar']} as Task;
  task.workflowPhaseHistory=appendStartedEntries(computeWorkflowInitialization(workflow,task,'dina').history,[workflow.phases[0]],'dina');
  return mergeAuthorizedTasks([], [task], users[0], settings, users).tasks[0];
}

test('previous revision comments do not obscure the current graph review queue', () => {
  const task = begin();
  task.status = 'sent_to_art_director';
  task.comments = [{ id: 'old-return', authorId: 'mina', action: 'request_edits', message: 'Revise the design' } as Task['comments'][number]];
  const userMap = Object.fromEntries(users.map(user => [user.id, user]));
  assert.equal(getStatusInfo(task, 'team_member', userMap).label, 'Waiting for Final Review');
  task.status = 'waiting_reviewer_full_review';
  assert.equal(getStatusInfo(task, 'team_member', userMap).label, 'Waiting for First Review');
});
function project(task:Task,result:NonNullable<ReturnType<typeof computeWorkflowAdvance>>|NonNullable<ReturnType<typeof computeWorkflowReturn>>,actor:string):Task {
  const phases=workflow.phases.filter(p=>result.nextActivePhaseIds.includes(p.id));
  const finished='finished' in result && result.finished;
  const next={...task,workflowActivePhaseIds:result.nextActivePhaseIds,workflowCurrentPhaseId:phases[0]?.id||null,
    workflowPhaseHistory:appendStartedEntries(result.history,phases,actor),workflowPhaseApprovals:result.approvals,
    status:finished?'completed':getStatusForWorkflowPhase(phases[0]),currentOwnerRole:phases[0]?getPhaseOwnerRole(phases[0]):null} as Task;
  const owners=phases.flatMap(p=>resolveWorkflowPhaseOwnerIds(p,next,settings,users));
  return {...next,currentOwnerUserId:owners[0]||null,currentOwnerUserIds:owners};
}
function advance(task:Task,upload=true):Task {
  const id=task.workflowActivePhaseIds![0];
  const phase=workflow.phases.find(p=>p.id===id)!;
  const actor=users.find(u=>u.id===getCurrentOwnerUserIds(task)[0])!;
  const submitted={...task,versions:phase.phaseKind==='work'&&upload?[{id:`v${task.versions.length+1}`,versionNumber:task.versions.length+1,submittedBy:actor.id,fileUrl:'https://docs.google.com/spreadsheets/d/placeholder',createdAt:new Date().toISOString()} as Task['versions'][number],...task.versions]:task.versions};
  const result=computeWorkflowAdvance(workflow,submitted,actor.id,id,settings,users)!;
  assert.ok(result); assert.equal(result.blockedReason,undefined);
  return mergeAuthorizedTasks([task],[project(submitted,result,actor.id)],actor,settings,users).tasks[0];
}
function sendBack(task:Task):Task {
  const actor=users.find(u=>u.id===getCurrentOwnerUserIds(task)[0])!;
  const result=computeWorkflowReturn(workflow,task,actor.id,task.workflowActivePhaseIds![0],undefined,settings,users)!;
  assert.ok(result);
  return mergeAuthorizedTasks([task],[project(task,result,actor.id)],actor,settings,users).tasks[0];
}

test('Banner Design runs six owners in order with one current-turn notice and cumulative access, closing only after Publishing',()=>{
  assert.equal(validateWorkflowGraph(workflow).valid,true);
  let task=begin();
  const reached=new Set<string>();
  const samaNoticeIds:string[]=[];
  for(let i=0;i<6;i++) {
    reached.add(ownerIds[i]);
    assert.deepEqual(task.workflowActivePhaseIds,[`step${i+1}`]);
    const notices=getHandoffNotifications(task,settings,users,new Date().toISOString());
    assert.deepEqual(notices.map(n=>n.userId),[ownerIds[i]]);
    if(ownerIds[i]==='sama')samaNoticeIds.push(notices[0].id);
    for(const user of users.filter(u=>['samar','sama','mariam','mina'].includes(u.id))) {
      assert.equal(canViewTask(task,user,settings,users),reached.has(user.id),user.name);
    }
    assert.equal(getWorkflowRoadmap(task,settings,users).filter(p=>p.state==='Finished').length,i);
    task=advance(task);
    if(i<5)assert.notEqual(task.status,'completed');
  }
  assert.equal(new Set(samaNoticeIds).size,2,'Sama receives separate notices for review and publishing');
  assert.equal(task.status,'completed');
  assert.deepEqual(task.workflowActivePhaseIds,[]);
  assert.deepEqual(getHandoffNotifications(task,settings,users,new Date().toISOString()),[]);
  assert.equal(getWorkflowRoadmap(task,settings,users).filter(p=>p.state==='Finished').length,6);
});

test('all three IF review returns notify the correct team and require downstream review again',()=>{
  for(const [reviewIndex,targetIndex] of [[1,0],[3,2],[4,2]]) {
    let task=begin();
    for(let i=0;i<reviewIndex;i++)task=advance(task);
    const previousNotice=getHandoffNotifications(task,settings,users,new Date().toISOString())[0].id;
    task=sendBack(task);
    assert.deepEqual(task.workflowActivePhaseIds,[`step${targetIndex+1}`]);
    assert.deepEqual(getHandoffNotifications(task,settings,users,new Date().toISOString()).map(n=>n.userId),[ownerIds[targetIndex]]);
    assert.equal(getWorkflowRoadmap(task,settings,users).filter(p=>p.state==='Finished').length,targetIndex);
    for(let i=targetIndex;i<6;i++)assert.equal(task.workflowPhaseApprovals?.[`step${i+1}`],undefined);
    for(let i=targetIndex;i<reviewIndex;i++)task=advance(task);
    assert.notEqual(getHandoffNotifications(task,settings,users,new Date().toISOString())[0].id,previousNotice,'a new visit generates a fresh handoff');
    for(let i=reviewIndex;i<6;i++)task=advance(task);
    assert.equal(task.status,'completed');
  }
});

test('Publishing requires its owner and a new upload; forged or invalidated AD approval cannot close it',()=>{
  let task=begin(); for(let i=0;i<5;i++)task=advance(task);
  assert.equal(task.status,'assigned_work');
  assert.throws(()=>advance(task,false),/new file/i);
  assert.equal(computeWorkflowAdvance(workflow,task,'mina','step6',settings,users),null);
  assert.throws(()=>mergeAuthorizedTasks([task],[{...task,status:'completed',workflowActivePhaseIds:[],workflowCurrentPhaseId:null}],users[0],settings,users));
  const forged=structuredClone(task);
  forged.workflowPhaseHistory=forged.workflowPhaseHistory!.map(e=>e.phaseId==='step5'&&e.action==='completed'?{...e,actorId:'sama'}:e);
  assert.throws(()=>advance(forged));
  const invalidated=structuredClone(task);
  invalidated.workflowPhaseHistory!.push({phaseId:'step5',phaseName:'Final Rev',action:'invalidated',actorId:'marwa',createdAt:new Date().toISOString()});
  assert.equal(computeWorkflowAdvance(workflow,invalidated,'sama','step6',settings,users)?.finished,false);
});

test('an unrelated terminal or a root Publishing entry cannot borrow final approval from another branch',()=>{
  const bypass=structuredClone(workflow);
  bypass.phases[5].parentPhaseIds=['workflow-root'];
  assert.equal(validateWorkflowGraph(bypass).valid,false);
  const detached=structuredClone(workflow);
  detached.phases.push({...detached.phases[0],id:'unreviewed',parentPhaseIds:['workflow-root'],passToPhaseId:null});
  assert.equal(validateWorkflowGraph(detached).valid,false);
});

