import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAppSettings, normalizeWorkflowTaskTypeId } from '../src/lib/appSettings';
import { mergeAuthorizedTasks } from '../server/taskAccess';
import { resolveWorkflowPhaseOwnerIds } from '../src/lib/workflowUtils';
import { computeWorkflowAdvance } from '../src/lib/workflowRuntime';
import { validateWorkflowGraph } from '../src/lib/workflowGraph';
import type { Task, User, WorkflowDefinition } from '../src/lib/types';

const member: User = {id:'review-member',name:'Member',role:'team_member'};
const leader: User = {id:'review-leader',name:'Leader',role:'team_leader'};
const oldAD: User = {id:'review-old-ad',name:'Original AD',role:'art_director'};
const newAD: User = {id:'review-new-ad',name:'Other AD',role:'art_director'};
const users=[member,leader,oldAD,newAD];
const workflow: WorkflowDefinition={id:'review-freeze',name:'Review Freeze',active:true,taskTypeIds:['reviewfreeze'],phases:[
  {id:'work',name:'Work',phaseKind:'work',reviewStyle:'first_review',mode:'sequential',userIds:[member.id],roleIds:[],responsibilityIds:[],parentPhaseIds:['workflow-root']},
  {id:'final',name:'Final Rev.',phaseKind:'final_review',reviewStyle:'final_review',mode:'sequential',userIds:[],roleIds:['art_director'],responsibilityIds:[],parentPhaseIds:['work']},
]};
const settings=mergeAppSettings({workflows:[workflow],manualUsers:users,finalReviewerUserIds:[oldAD.id]});
const task: Task={id:'review-task',code:'QA15',reviewMode:'final_review',environment:'production',deadlineText:null,thumbnailUrl:'',name:'Review assignment',taskType:workflow.taskTypeIds![0],createdBy:leader.id,handledBy:[member.id],status:'assigned_work',priority:'normal',versions:[],comments:[],assignmentLinks:[],workflowId:workflow.id,workflowSnapshot:workflow,workflowActivePhaseIds:['work'],workflowCurrentPhaseId:'work',workflowPhaseHistory:[],workflowPhaseApprovals:{},workflowNodeAssigneeIds:{work:[member.id],final:[oldAD.id]},workflowFinalApproverIdsByPhaseId:{final:oldAD.id},currentOwnerUserId:member.id,currentOwnerUserIds:[member.id],currentOwnerRole:'team_member',createdAt:'2026-09-14T08:00:00.000Z',updatedAt:'2026-09-14T08:00:00.000Z'} as Task;
const check = test;
check('post-review work may finish after final approval but invalidated review cannot finish',()=>{
 const legacy=structuredClone(workflow);
 legacy.phases.push({...legacy.phases[0],id:'tail',name:'Post-review work',parentPhaseIds:['final']});
 const before=JSON.stringify(legacy);
 assert.equal(validateWorkflowGraph(legacy).valid,true);
 const prior={...structuredClone(task),workflowSnapshot:legacy,workflowActivePhaseIds:['tail'],workflowCurrentPhaseId:'tail',workflowNodeAssigneeIds:{...task.workflowNodeAssigneeIds,tail:[member.id]},workflowPhaseHistory:[
  {phaseId:'work',phaseName:'Work',action:'completed' as const,actorId:member.id,createdAt:task.createdAt},
  {phaseId:'final',phaseName:'Final Rev.',action:'completed' as const,actorId:oldAD.id,createdAt:task.createdAt},
 ]};
 const advanced=computeWorkflowAdvance(legacy,prior,member.id,'tail',settings,users);
 assert.equal(advanced?.finished,true);assert.equal(advanced?.blockedReason,undefined);
 const reopened={...prior,workflowPhaseHistory:[...prior.workflowPhaseHistory,{phaseId:'final',phaseName:'Final Rev.',action:'invalidated' as const,actorId:oldAD.id,createdAt:task.createdAt}]};
 assert.equal(computeWorkflowAdvance(legacy,reopened,member.id,'tail',settings,users)?.finished,false);
 assert.equal(JSON.stringify(legacy),before,'saved graph remains intact');
});
check('legitimate new frozen assignment accepted',()=>assert.equal(mergeAuthorizedTasks([], [structuredClone(task)], leader,settings,users).tasks.length,1));
check('new assignment cannot inject a different frozen owner while leaving node override canonical',()=>{
 const forged=structuredClone(task);forged.workflowFinalApproverIdsByPhaseId={final:newAD.id};
 assert.throws(()=>mergeAuthorizedTasks([], [forged],leader,settings,users));
});
check('safe legacy map migration allowed',()=>{
 const prior=structuredClone(task);delete prior.workflowFinalApproverIdsByPhaseId;
 assert.equal(mergeAuthorizedTasks([prior],[structuredClone(task)],leader,settings,users).tasks[0].workflowFinalApproverIdsByPhaseId?.final,oldAD.id);
});
check('invalid frozen owner fails closed after role change',()=>{
 const roster=users.map(u=>u.id===oldAD.id?{...u,role:'team_member' as const}:u);
 const changed={...settings,finalReviewerUserIds:[newAD.id]};
 assert.deepEqual(resolveWorkflowPhaseOwnerIds(workflow.phases[1],task,changed,roster),[]);
});
check('original frozen AD can complete actual final approval after global default changes',()=>{
 const prior=structuredClone(task);
 prior.status='sent_to_art_director';prior.workflowActivePhaseIds=['final'];prior.workflowCurrentPhaseId='final';
 prior.currentOwnerRole='art_director';prior.currentOwnerUserId=oldAD.id;prior.currentOwnerUserIds=[oldAD.id];
 prior.workflowPhaseHistory=[{phaseId:'work',phaseName:'Work',action:'completed',actorId:member.id,createdAt:prior.createdAt}];
 const changed={...settings,finalReviewerUserIds:[newAD.id]};
 const advanced=computeWorkflowAdvance(workflow,prior,oldAD.id,'final',changed,users);
 assert.ok(advanced?.finished);
 const next={...prior,status:'approved_by_art_director' as const,workflowActivePhaseIds:advanced.nextActivePhaseIds,workflowCurrentPhaseId:null,workflowPhaseApprovals:advanced.approvals,workflowPhaseHistory:advanced.history,currentOwnerUserId:null,currentOwnerUserIds:[]};
 assert.equal(mergeAuthorizedTasks([prior],[next],oldAD,changed,users).tasks[0].status,'approved_by_art_director');
});
