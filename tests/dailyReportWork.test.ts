import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActualWorkEntries,mergeWorkReportEntries} from '../src/lib/dailyReportWork';
import {planDailyReports} from '../src/lib/dailyReportScheduler';
import {mergeAppSettings} from '../src/lib/appSettings';
import {runDeadlineReminders} from '../api/cron/deadline-reminders';
import type {Task,User,DailyReport} from '../src/lib/types';
const member:User={id:'member',name:'Member',role:'team_member'}, senior:User={id:'senior',name:'Senior',role:'reviewer'}, leader:User={id:'lead',name:'Leader',role:'team_leader'}, ad:User={id:'ad',name:'AD',role:'art_director'};
const users=[member,senior,leader,ad];
const settings=mergeAppSettings({manualUsers:users,reportingSeniorByUserId:{member:'senior'},dailyReportAutoSendEnabled:true,businessCalendar:{timezone:'Africa/Cairo',workdays:[0,1,2,3,4],startTime:'09:00',endTime:'17:30'}});
const task={id:'worked',code:'WORK',name:'Recorded work',environment:'production',status:'assigned_work',createdBy:'lead',handledBy:['member','senior'],versions:[],workflowPhaseHistory:[],workSessions:[{id:'session',userId:'member',phaseId:'work',startedAt:'2026-09-14T06:00:00Z',finishedAt:'2026-09-14T07:00:00Z'}]} as unknown as Task;
const at=(time:string)=>new Date('2026-09-14T'+time+':00Z');
test('reports attribute actual work only, preserve former workers and use Cairo clocks',()=>{
 const unstarted={...task,id:'unstarted',workSessions:[],workflowPhaseHistory:[{phaseId:'work',phaseName:'Work',action:'started' as const,actorId:'senior',createdAt:at('06:00').toISOString()}]};
 const entries=buildActualWorkEntries([task,unstarted],'member','2026-09-14',settings,users,at('14:29'));
 assert.equal(entries.length,1);assert.equal(entries[0].startTime,'09:00');assert.equal(entries[0].endTime,'10:00');assert.equal(entries[0].durationMinutes,60);
 assert.deepEqual(buildActualWorkEntries([task,unstarted],'senior','2026-09-14',settings,users,at('14:29')),[]);
});
test('overlapping sessions are not double counted and cross-midnight work belongs to each Cairo day',()=>{
 const overlap={...task,workSessions:[...task.workSessions!,{...task.workSessions![0],id:'parallel',startedAt:'2026-09-14T06:30:00Z',finishedAt:'2026-09-14T07:30:00Z'}]};
 assert.equal(buildActualWorkEntries([overlap],'member','2026-09-14',settings,users,at('14:29'))[0].durationMinutes,90);
 const night={...task,workSessions:[{...task.workSessions![0],startedAt:'2026-09-13T20:30:00Z',finishedAt:'2026-09-13T22:30:00Z'}]};
 assert.equal(buildActualWorkEntries([night],'member','2026-09-14',settings,users,at('14:29'))[0].durationMinutes,90);
});
test('saved manual changes and side work survive fresh automatic calculation',()=>{
 const actual=buildActualWorkEntries([task],'member','2026-09-14',settings,users,at('14:29'));
 const saved=[{...actual[0],manuallyEdited:true,workState:'active' as const,startTime:'08:30',durationMinutes:90},{taskId:'manual:meeting',title:'Meeting',source:'manual' as const,startTime:'11:00',endTime:'11:30',durationMinutes:30}];
 const merged=mergeWorkReportEntries(actual,saved);assert.equal(merged[0].startTime,'08:30');assert.equal(merged[1].title,'Meeting');assert.equal(merged[0].workState,'finished');
});
test('17:15 warning and 17:29 submission are Cairo-based, idempotent, and skip empty/exempt users',()=>{
 assert.equal(planDailyReports([task],[],settings,users,at('14:14')).changedIds.length,0);
 const warning=planDailyReports([task],[],settings,users,at('14:15'));assert.equal(warning.notifications.length,3);assert.ok(warning.reports.every(r=>!r.sentAt));
 assert.equal(planDailyReports([task],warning.reports,settings,users,at('14:28')).notifications.length,0);
 const sent=planDailyReports([task],warning.reports,settings,users,at('14:29'));assert.equal(sent.reports.filter(r=>r.sentAt).length,1);assert.deepEqual(sent.notifications.map(n=>n.userId).sort(),['ad','lead','senior']);assert.equal(sent.reports[0].entries[0].title,'Recorded work');
 assert.equal(planDailyReports([task],sent.reports,settings,users,at('15:00')).changedIds.length,0);
 assert.equal(planDailyReports([task],[],settings,users,new Date('2026-09-18T14:29:00Z')).changedIds.length,0);
});
test('winter offset, late same-day catch-up, and manual submissions preserve their receipts',()=>{
 const side={id:'2026-01-05:lead',userId:'lead',date:'2026-01-05',note:'Reviewed planning',entries:[],createdAt:'2026-01-05T08:00:00Z',updatedAt:'2026-01-05T08:00:00Z',editHistory:[]} as DailyReport;
 assert.equal(planDailyReports([], [side],settings,users,new Date('2026-01-05T15:14:00Z')).changedIds.length,0);
 const result=planDailyReports([], [side],settings,users,new Date('2026-01-05T15:45:00Z'));assert.ok(result.reports.find(r=>r.id===side.id)?.sentAt);assert.ok(result.notifications.some(n=>n.userId==='ad'));
 assert.equal(planDailyReports([],result.reports,settings,users,new Date('2026-01-05T16:00:00Z')).changedIds.length,0);
});
test('background scheduler commits reports and notices atomically with retry and failure recovery',async()=>{
 let state:any={tasks:[task],settings,notifications:[],dailyReports:[]};let revision='1';let race=true;let fail=false;let writes=0;
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{const q=parts.join('?');if(q.includes('SELECT record'))return[];if(q.includes('SELECT state, updated_at'))return[{state:structuredClone(state),updated_at:revision}];if(q.includes('UPDATE app_state')){if(fail)throw Error('DB failure');if(race){race=false;state.dailyReports=[{id:'2026-09-14:member',userId:'member',date:'2026-09-14',note:'Concurrent saved note',entries:[],editHistory:[],createdAt:at('06:00').toISOString(),updatedAt:at('14:28').toISOString()}];revision='2';}if(values[2]!==revision)return[];state=JSON.parse(values[0] as string);revision=String(Number(revision)+1);writes++;return[{updated_at:revision}];}throw Error(q);};
 fail=true;await assert.rejects(()=>runDeadlineReminders(sql as never,[],at('14:29')));assert.equal(state.dailyReports.length,0);
 fail=false;const result=await runDeadlineReminders(sql as never,[],at('14:29'));assert.equal(result.attempts,2);assert.equal(state.dailyReports[0].note,'Concurrent saved note');assert.ok(state.dailyReports[0].sentAt);assert.equal(state.dailyReports[0].entries.length,1);assert.equal(writes,1);
 state.notifications=[];assert.equal((await runDeadlineReminders(sql as never,[],at('14:30'))).generated,0);assert.equal(writes,1);
});
