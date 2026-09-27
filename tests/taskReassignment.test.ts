import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppSettings } from '../src/lib/appSettings';
import { validateTaskReassignment } from '../server/taskReassignment';
import { reconcileWorkSessions, canStartTaskWork } from '../src/lib/workSessions';
import { getReassignmentNotifications } from '../src/lib/reassignmentNotifications';
import { canEditTask, canViewTask } from '../src/lib/taskPolicy';
import type {Task,User,WorkflowDefinition} from '../src/lib/types';
const a:User={id:'a',name:'A',role:'team_member'}, b:User={id:'b',name:'B',role:'team_member'}, c:User={id:'c',name:'C',role:'team_member'},leader:User={id:'new-leader',name:'Leader',role:'team_leader'},ad:User={id:'ad',name:'AD',role:'art_director'};
const users=[a,b,c,leader,ad];
const p=(id:string,owner:string,parents:string[])=>({id,name:id,phaseKind:'work' as const,reviewStyle:'first_review' as const,mode:'sequential' as const,userIds:[owner],roleIds:[],responsibilityIds:[],parentPhaseIds:parents});
const flow:WorkflowDefinition={id:'flow',name:'Flow',active:true,phases:[p('a','a',['workflow-root']),p('b','b',['workflow-root']),p('future','a',['a','b']),{...p('final','ad',['future']),phaseKind:'final_review',roleIds:['art_director']}]};
const settings=mergeAppSettings({manualUsers:users,workflows:[flow],finalReviewerUserIds:['ad']});
const base={id:'reassign',name:'Reassign',createdBy:leader.id,handledBy:['a','b'],status:'assigned_work',versions:[],comments:[],workflowId:flow.id,workflowSnapshot:flow,workflowActivePhaseIds:['a','b'],workflowCurrentPhaseId:'a',workflowNodeAssigneeIds:{a:['a'],b:['b'],future:['a'],final:['ad']},workflowFinalApproverIdsByPhaseId:{final:'ad'},currentOwnerUserIds:['a','b'],workflowPhaseHistory:[],updatedAt:'2026-09-15T08:00:00Z'} as unknown as Task;
const start=(prior:Task,user:User,time:string)=>reconcileWorkSessions(prior,{...prior,activeWorkBy:user.id,activeWorkStartedAt:time,activeWorkFinishedAt:null,activeWorkFinishedById:null,updatedAt:time},settings,users);
const replace=(prior:Task,phase:string,owner:string)=>({...prior,workflowNodeAssigneeIds:{...prior.workflowNodeAssigneeIds,[phase]:[owner]},updatedAt:'2026-09-15T08:10:00Z'});
test('two simultaneous workers retain independent sessions and either can finish their own',()=>{
 const one=start(base,a,'2026-09-15T08:01:00Z');const two=start(one,b,'2026-09-15T08:02:00Z');
 assert.equal(two.workSessions!.filter(s=>!s.finishedAt).length,2);
 const finished=reconcileWorkSessions(two,{...two,activeWorkFinishedAt:'2026-09-15T08:03:00Z',activeWorkFinishedById:a.id,updatedAt:'2026-09-15T08:03:00Z'},settings,users);
 const canonical=validateTaskReassignment(two,finished,a,settings,users);
 assert.ok(canonical.workSessions!.find(s=>s.userId==='a')!.finishedAt);assert.equal(canonical.workSessions!.find(s=>s.userId==='b')!.finishedAt,null);
});
test('active reassignment stops only displaced session and retains read-only contribution history',()=>{
 const prior=start(start(base,a,'2026-09-15T08:01:00Z'),b,'2026-09-15T08:02:00Z');
 const next=validateTaskReassignment(prior,replace(prior,'a','c'),leader,settings,users);
 assert.equal(next.workSessions!.find(s=>s.userId==='a')!.endReason,'reassigned');assert.equal(next.workSessions!.find(s=>s.userId==='b')!.finishedAt,null);
 assert.equal(canViewTask(next,a,settings,users),true);assert.equal(canEditTask(next,a,settings,users),false);assert.equal(canStartTaskWork(next,'a',settings,users),false);
 const notices=getReassignmentNotifications(prior,next,settings,users);assert.deepEqual(notices.map(n=>n.userId).sort(),['a','c']);
});
test('unstarted removals and future edits do not notify or start sessions prematurely',()=>{
 const next=validateTaskReassignment(base,replace(base,'a','c'),leader,settings,users);
 assert.deepEqual(getReassignmentNotifications(base,next,settings,users).map(n=>n.userId),['c']);
 const future=validateTaskReassignment(base,replace(base,'future','c'),leader,settings,users);
 assert.deepEqual(getReassignmentNotifications(base,future,settings,users),[]);assert.deepEqual(future.workSessions,[]);
});
test('ordinary owners cannot reassign; completed and fixed final ownership stay protected',()=>{
 assert.throws(()=>validateTaskReassignment(base,replace(base,'a','c'),a,settings,users),/leadership/);
 const past={...base,workflowPhaseHistory:[{phaseId:'a',phaseName:'a',action:'completed' as const,actorId:'a',createdAt:base.updatedAt}]};
 assert.throws(()=>validateTaskReassignment(past,replace(past,'a','c'),leader,settings,users),/active or future/);
});
test('session records cannot fabricate workers or rewrite canonical history',()=>{
 const prior=start(base,a,'2026-09-15T08:01:00Z');
 assert.throws(()=>validateTaskReassignment(prior,{...prior,workSessions:[{...prior.workSessions![0],userId:'b'}]},a,settings,users));
 assert.throws(()=>validateTaskReassignment(prior,{...prior,activeWorkBy:'b',activeWorkStartedAt:'2026-09-15T08:02:00Z'},a,settings,users));
 const restored=validateTaskReassignment(prior,{...prior,workSessions:[]},leader,settings,users);assert.equal(restored.workSessions!.length,1);
});

test('hydration cleanup of duplicate contributors and empty optional maps is not reassignment',()=>{
 const prior={...base,handledBy:['a','a','b'],workflowNodeAIAssigneeIds:undefined,workflowNodeVoiceOverDeliveryOwnerIds:undefined,contentRevisionAssigneeIds:undefined};
 assert.doesNotThrow(()=>validateTaskReassignment(prior,{...prior,handledBy:['a','b'],workflowNodeAIAssigneeIds:{},workflowNodeVoiceOverDeliveryOwnerIds:{},contentRevisionAssigneeIds:[]},a,settings,users));
});
