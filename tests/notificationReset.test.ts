import test from 'node:test';
import assert from 'node:assert/strict';
import { filterResetNotifications, planNotificationReset } from '../src/lib/notificationReset';
import { createAppStateHandler } from '../api/app-state';
import { createWorkspaceAuth } from '../server/workspaceAuth';
import { mergeAppSettings } from '../src/lib/appSettings';
import type { PersistedAppState } from '../src/lib/localDb';
import type { Notification, Task, User } from '../src/lib/types';

const leader: User = {id:'reset-leader',name:'Leader',role:'team_leader'};
const member: User = {id:'reset-member',name:'Member',role:'team_member'};
const notice=(id:string,userId=leader.id):Notification=>({id,userId,taskId:'task',message:id,createdAt:'2026-09-14T08:00:00.000Z',read:false});

test('reset records exact old IDs once and retains new IDs even when timestamps are old',()=>{
 const first=planNotificationReset([notice('old')],{notificationResetVersion:0},undefined,'2026-09-14T09:00:00.000Z');
 assert.deepEqual(first.notifications,[]);
 assert.deepEqual(first.reset.clearedIds,['old']);
 const next=planNotificationReset([notice('old'),notice('new')],{notificationResetVersion:0},first.reset);
 assert.deepEqual(next.notifications.map(n=>n.id),['new']);assert.deepEqual(next.reset,first.reset);
 assert.deepEqual(filterResetNotifications([{...notice('old'),createdAt:'2099-01-01T00:00:00Z'}],first.reset),[]);
});

test('v2 workspaces preserve their current feed and receive no second destructive reset',()=>{
 const plan=planNotificationReset([notice('already-new')],{notificationResetVersion:2});
 assert.deepEqual(plan.reset.clearedIds,[]);assert.equal(plan.notifications.length,1);
});

function fixture(version=0) {
 const users=[leader,member];
 const db={revision:'2026-09-14T08:00:00.000Z', conflict:false, state:{
  settings:mergeAppSettings({notificationResetVersion:version,manualUsers:users,workflows:[]}),
  tasks:[{id:'task',name:'Task',createdBy:leader.id,handledBy:[member.id],currentOwnerUserIds:[member.id],currentOwnerUserId:member.id,currentOwnerRole:'team_member',status:'assigned_work',versions:[],workflowPhaseHistory:[]} as unknown as Task],
  notifications:[notice('legacy-own'),notice('legacy-hidden',member.id)],dailyReports:[],
 } as PersistedAppState};
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{
  const query=parts.join('?').replace(/\s+/g,' ').trim();
  if(query.startsWith('CREATE TABLE')||query.startsWith('SELECT record')||query.startsWith('SELECT workflow_id'))return [];
  if(query.startsWith('SELECT state, updated_at'))return [{state:structuredClone(db.state),updated_at:db.revision}];
  if(query.startsWith('WITH written AS')){
   if(db.conflict||values[3]!==db.revision)return [];
   db.state=JSON.parse(values[1] as string);db.revision=new Date(Date.parse(db.revision)+1).toISOString();return [{updated_at:db.revision}];
  }
  throw Error(query);
 };
 const auth=createWorkspaceAuth({env:{SUPABASE_URL:'https://supabase.example.test',SUPABASE_ANON_KEY:'test-key',WORKSPACE_SESSION_SECRET:'test-only'},fetch:async url=>new Response(JSON.stringify(String(url).includes('/auth/v1/user')?{id:leader.id}:users))});
 const handler=createAppStateHandler(()=>sql as never,auth,()=>new Date('2026-09-14T09:00:00Z'));
 async function request(method:string,body?:unknown){let status=0;let data:any;await handler({method,url:'/api/app-state',headers:{host:'workspace.test',authorization:'Bearer test'},body},{setHeader(){},status(code:number){status=code;return{json(value:unknown){data=value;},end(){}};}});return{status,data};}
 return{db,request};
}

test('API cleanup is atomic, retains concurrent new notices, hides private reset IDs and ignores stale reset metadata',async()=>{
 const{db,request}=fixture();const original=structuredClone(db.state);
 const read=await request('GET');assert.deepEqual(read.data.state.notifications,[]);assert.equal(read.data.state.notificationReset,undefined);
 const task={...original.tasks[0],name:'Updated during cleanup'};
 const write=await request('PUT',{state:{...original,tasks:[task],notifications:[...original.notifications,notice('new')],notificationReset:{version:3,clearedIds:[]}},changedTaskIds:['task'],expectedUpdatedAt:db.revision});
 assert.equal(write.status,200);assert.deepEqual(db.state.notifications.map(n=>n.id),['new']);
 assert.deepEqual(db.state.notificationReset?.clearedIds,['legacy-own','legacy-hidden']);
 assert.equal(db.state.settings?.notificationResetVersion,3);
 assert.equal(JSON.stringify(write.data).includes('legacy-hidden'),false);
 const later=await request('PUT',{state:{...original,notifications:[...original.notifications,notice('new')],notificationReset:{version:3,clearedIds:['new']}},changedTaskIds:[],expectedUpdatedAt:db.revision});
 assert.equal(later.status,200);assert.deepEqual(db.state.notifications.map(n=>n.id),['new']);assert.equal(db.state.settings?.notificationResetVersion,3);
 const reread=await request('GET');assert.equal(reread.data.state.notificationReset,undefined);assert.deepEqual(reread.data.state.notifications.map((n:Notification)=>n.id),['new']);
});

test('a failed compare-and-swap does not commit cleanup and a retry uses the fresh canonical backlog',async()=>{
 const{db,request}=fixture();const before=JSON.stringify(db.state);db.conflict=true;
 assert.equal((await request('PUT',{state:{tasks:[]},changedTaskIds:[],expectedUpdatedAt:db.revision})).status,409);
 assert.equal(JSON.stringify(db.state),before);
 db.conflict=false;assert.equal((await request('PUT',{state:{tasks:[]},changedTaskIds:[],expectedUpdatedAt:db.revision})).status,200);
 assert.deepEqual(db.state.notifications,[]);assert.equal(db.state.notificationReset?.version,3);
});

test('existing v2 API feed is preserved on upgrade and whole-state omission',async()=>{
 const{db,request}=fixture(2);
 assert.equal((await request('GET')).data.state.notifications.length,1);
 assert.equal((await request('PUT',{state:{tasks:[],notifications:[]},changedTaskIds:[],expectedUpdatedAt:db.revision})).status,200);
 assert.equal(db.state.notifications.length,2);assert.deepEqual(db.state.notificationReset?.clearedIds,[]);
});
