# ClickUp implementation progress

User instruction: implement tasks 1–20 in order and independently test/review each task before advancing. After Kimi's quota block, the user authorized model selection across OpenCode Go, Antigravity and Codex. Current allocation: Codex Astra for runtime/complex integration, Codex Sol for focused UI work, Gemini Pro via Antigravity for independent review when available.

Worker: `opencode-go/kimi-k3`, primary agent `build`, installed OpenCode 1.18.4. Health and capability inspection passed for this model. An optional CLI update was offered; no update has been applied.

Working branch: `codex/clickup-20-workflow-governance`.

## Current task

**Tasks 1–20 implemented and individually checked locally. Final regression passed on 2026-09-15.** Parent Codex completed and reviewed the remaining work after the documented external worker interruptions. See `clickup-final-review-2026-09-15.md` for final evidence and the production scheduler limitation.

Worker artifacts: `D:/programming/national-care-opencode-runs/2026-09-13/task-01-attempt-01/` and `task-01-attempt-02/`. Runtime correction brief: `task-01-runtime-revision.md` in the same run root. Attempt 1 acceptance verdict is **revise**.

Review environment: local Vite on port 4318 with Neon/Drive disabled and dummy Supabase configuration. The `national-care-review` Playwright browser has stubbed profile/settings responses. Synthetic data is stored only in that browser. No production changes have been made.

Baseline browser observation: approving synthetic Step A advances to Step B owned by the same person and creates one notification for that owner. This is a pre-change baseline, not acceptance of the worker result. Browser console showed no errors or warnings for this scenario.

Further baseline verification: Step B correctly hands off to reviewer B and survives reload. However, reviewer A can then use **Mark Approved** to skip the remaining steps and notify unrelated reviewers. The persisted task is marked approved while still retaining an active workflow phase. This is a confirmed acceptance failure to recheck in the worker result. The upload action also reinitializes the workflow and broadcasts to future contributors in the baseline source.

## Queue

| Task | Status |
| --- | --- |
| 1 | Accepted locally: 29 permanent + 3 independent tests; lint/build; browser handoffs/upload/returns/delays/reload |
| 2 | Accepted locally: 10 task-type tests + 29 runtime tests; lint/build; dropdown and empty-workflow browser checks |
| 3 | Accepted locally: 49 cumulative tests; lint/build; deletion/reload/login/failure/retry/mobile checks |
| 4 | Accepted locally: 71 cumulative tests; lint/build; authenticated browser role/edit/save/reload checks |
| 5 | Accepted locally: 82 cumulative + 2 independent tests; lint/build; role/Cairo/create/edit/mobile browser checks; production trigger still requires configuration |
| 6 | Accepted locally: 91 cumulative + 3 independent tests; lint/build; UI/direct-link/API/upload/delay/cache/logout checks |
| 7 | Accepted locally: wording/status/system-message review; lint/build; comment confirmation and AD dialog browser checks |
| 8 | Accepted locally: 97 cumulative tests; lint/build; include/omit upload routes, reload and final builder locks |
| 9 | Accepted locally: exact parallel/sequential/delayed/legacy owners; approval/hold/return/reload/mobile checks; lint/build |
| 10 | Accepted locally: 106 tests; lint/build; Unicode builder, invalid/collision/owner rejection, retained forms, creation/upload/snapshot/reload |
| 11 | Accepted locally: create/rename/disable/enable/delete/stale reload; snapshot preservation; both dropdowns/mobile; lint/build |
| 12 | Accepted locally: 112 tests; provider/delivery/visibility/upload/returns/edit/browser checks; mobile dropdown correction; lint/build |
| 13 | Accepted locally: truthful upload copy, narrow existing-template migration, custom/snapshot preservation, browser reload, lint/build |
| 14 | Accepted locally: 121 tests; both creation forms, active/future/edit/restore/parallel/hold/return/mobile; authenticated HTTP guard/positive handoff/reload; lint/build |
| 15 | Accepted locally: 136 tests; 13 HTTP forgery rejections; full 3-upload/return/final flow; creation, frozen owner/edit/reload/member/mobile; lint/build |
| 16 | Accepted locally: stock/legacy/custom copy test; builder reload and real AD detail/mobile; saved snapshot unchanged; lint |
| 17 | Accepted locally: 142 tests; atomic cleanup/stale writes/privacy; local cache/reload and actual API upload/notice/reload; lint/build |
| 18 | Accepted locally: 147 tests; branch/owner policy, all task layouts, leader/member gates, desktop/mobile; lint |
| 19 | Accepted locally: 153 tests (152 full suite + new hydration case); local and authenticated API reassignment/reload/403 checks; full 3-upload/return/AD flow; lint |
| 20 | Accepted locally: work/session and scheduler tests; real UI side-work/edit/reload/mobile; actual background API with app closed, receipts/privacy/stale-draft rejection |

### Later acceptance checks identified during implementation

- Task 9: TaskDetail's active phase owner is accurate, but its extra legacy First review / Final approval rows can still show unrelated default reviewers or “Not set” beside a workflow snapshot. Replace these with the actual configured/active review phases.
- Task 10: builder task-type duplicate checks must use the same whitespace/punctuation normalization as workflow-owned dropdowns; validate rename/delete persistence and preserve existing snapshots.
- Task 15: enforce mandatory Art Director completion in the authenticated server mutation path as well as UI/runtime actions. A broad permission to edit a visible task must not let a crafted full-state request set a terminal status or skip the final approval.
- Task 19: validate assignment/route mutations against leadership permissions on the server; current owner permission to upload/comment/advance must not authorize arbitrary reassignment of future steps. Preserve an actual started-work record before clearing displaced active work, so the displaced worker receives the intended removal notice without restoring future-task access.

## Scope assumptions used under the user's instruction to proceed

- Existing tasks keep saved workflows; leadership can edit an individual task.
- AI voice-over is produced externally and uploaded by a responsible person.
- Reminders and reports should support execution with browsers closed; notification delivery is in-app.
- Report times use Africa/Cairo and configured working days.
- Team Leader reports only upward; Art Director and Marketing Manager are exempt. Seniors supervise their own teams.
- Required Art Director approval cannot be removed.

## Protected starting changes

The user's existing Dashboard.tsx layout change and appSettings.ts responsibility cleanup are preserved. The existing test-results folder is also preserved. A baseline patch was saved outside the repository in the run folder.

Each accepted task must record: worker attempt, reviewed files, independent test commands/results, browser acceptance where relevant, and any remaining limitation. Worker prose and exit code alone do not establish acceptance.

## Independent checks completed before the quota block

- `npm run test`: 12 passed, 2 failed (legacy no-edge fallback and disconnected-node initialization).
- `npx tsx --test output/playwright/task01-independent-routing-checks.ts`: 0 passed, 3 failed (manual omitted step incorrectly ends workflow, explicit empty assignment falls back to a reviewer, skipped root activates an unrelated first array node).
- Browser baseline A -> A -> B handoffs passed and survived reload, with correct limited recipients.
- Browser baseline **Mark Approved** bypass failed: previous owner could finish the task while another owner held the next phase, skipping Art Director approval.
- Browser baseline assignment upload failed: a synthetic work upload stayed on phase A instead of advancing to B and notified the future reviewer and Art Director plus creator. Browser fixture scripts under `output/playwright/` use local data and mock Drive/Supabase responses; no real file was uploaded.
- New runtime has additional review concerns documented outside the repo: return/resubmit invalidation, manual/disabled pass-through routing, different delays on parallel phases, mandatory final approval, sequential owner handoff, and UI/store integration.
- At that initial checkpoint no task had been accepted. The accepted local results below supersede it; nothing has been marked complete in ClickUp, committed, pushed, or deployed.

## Task 1 acceptance evidence (supersedes the initial failing draft)

- Final `npm run lint`, `npm run test` (29/29), `npx tsx --test output/playwright/task01-independent-routing-checks.ts` (3/3), and `npm run build` all passed. Build retains the existing large-bundle warning.
- Browser A -> A -> B: correct owner/name notices, same-person handoff preserved, state survived reload, and previous owner's Mark Approved bypass absent.
- Browser work upload A -> B owned by the same uploader: one version saved, active step advanced instead of restarting, one notification only to next owner; approval button available to the explicitly assigned uploader on next step.
- Browser return B -> A -> resubmit V2 -> B passed. A return-note notification fanout was found and fixed; repeating the return added only the new active owner's notice.
- Browser parallel delayed phases: zero early notifications/owners; first due phase released alone; second remained pending at intermediate check and released at its own time; reload retained exactly two distinct notices with no duplicates.
- Browser console: zero errors in checked flows. All test data/services isolated; no real Drive upload or production changes.
- Independent Codex review found and verified fixes for phase-jump bypass, missing-map legacy delay bypass, non-primary parallel skip targeting, collapsed workflow-change handoffs, and snapshot corruption from task-type edits.
- Saved workflow changes now restart from configured roots through a guarded leadership action. Existing snapshots remain stable during uploads and basic edits. Final AD cannot be skipped.
- Tasks 14 and 19 will extend per-task omission/reassignment controls; this acceptance covers workflow execution/handoff routing. ClickUp completion status and deployment have not been changed.


## Task 2 acceptance evidence

- Codex Sol implemented workflow-owned type options, matching metadata, stable reload cleanup, removal of standalone editors and safe empty-workflow form states. Parent added store guards on new task/assignment creation.
- Parent independently inspected the diffs and verified `npm run test` (39/39), `npm run lint`, and `npm run build`. Existing bundle-size warning remains.
- Browser baseline dropdown exposed QA OWNED, LEGACY STRAY, DISABLED STRAY and OLD MAPPED OBJECT. After edits/reload only QA OWNED remained.
- Disabling every workflow displayed guidance to activate a workflow, left the task type empty, and disabled Add Assignment. Browser console errors: zero.
- Ten focused tests cover stale aliases, dangling metadata, inactive/deleted workflows, metadata decoration, normalization/duplicates, version-0 migration retaining owned video type, missing IDs/name fallback, reload stability and empty workflows.
- Existing saved-workflow uploads are preserved. Tasks 10 and 11 will separately exercise builder creation/rename/delete and end-to-end assignment integration.
- Additional task 2 browser acceptance: created a new assignment using QA LINEAR; persisted task type qa linear resolves to workflow qa-linear, starts qa-a, and emits exactly one notice to that phase owner.


## Task 3 acceptance evidence

- Codex Astra implemented durable member identity records, deletion checks, local atomic persistence, Neon revision checks and login/session filtering. Sol implemented awaited deletion feedback, blocking task links, self-removal protection and mobile focus/scroll behavior.
- Parent independent checks: 49/49 cumulative tests, TypeScript, build and diff check passed. Zero browser console errors. Existing bundle warning remains.
- Manual member and same-email registered alias stayed removed after reload despite stale settings/profile responses. Historical task authors remained. A separate registered member was also removed successfully.
- Future assigned reviewer removal was blocked with exact task code/step and link; self removal disabled. Simulated local write failure kept the member present and displayed the failure; retry succeeded.
- Removed manual login, signup using removed email, and a mocked persisted Supabase session were denied. Local stale-state save could not restore a removed member. Server handler tests cover stale second-client writes and both deletion/assignment races with no partial tombstones.
- Mobile: width 390, page width 390; result banner focused and scrolled into view at top 16px. Screenshot: output/playwright/task03-mobile-blocked.png.
- Supported acceptance paths are Neon and local IndexedDB. Drive-backed member removal explicitly returns unsupported without mutation because that legacy storage path has no reliable deletion transaction. External identity-provider accounts are retained; app membership/access is removed.
- No production data changes, status updates, commits or deployment.

## Task 4 acceptance evidence

- Parent owns src/lib/reportPolicy.ts and tests/reportPolicy.test.ts (11 focused cases passing).
- Astra owns server authentication/report projections, store permissions/recipients and persistence integration. Sol owns DailyReports UI and the member reporting-senior selector.
- Working rule: ordinary members to one own senior plus higher leadership; seniors to leadership, no peer access; Team Leader reports upward; AD/MM exempt; drafts private; inspection does not allow editing another report.
- Ambiguous same-team seniors require an explicit per-member selection. Senior report permissions take precedence over their administrative tool access.
- Parent independently verified 71/71 cumulative tests, lint, build and diff check. Existing bundle-size warning remains.
- Local browser role matrix passed for member, senior, Team Leader and Art Director: drafts hidden, upward access only and exempt roles have no own-report submission controls.
- An isolated HTTP server exercised the actual production API handler, signed HttpOnly cookie authentication and fake SQL. Two successive own-report edits persisted and survived reload/session restoration. The own senior and Team Leader received two edit notifications; the design peer received none. Filtered saves preserved reports hidden from the writer. No credential hashes appeared in responses. No console or page errors occurred in these checks.
- Eleven server tests cover anonymous/forged identities, password compatibility, session expiry/revocation, safe directory echoes, author-only changes, protected hierarchy settings, notification audience, origin checks and verified Supabase profiles.
- Neon fallback caches omit reports and report notifications, including cleanup of legacy cache content. Old Supabase settings mirrors are no longer written in Neon mode. Historical credential copies already in the old mirror require a deployment migration; no production data was read or altered.
- Accepted locally, not deployed or marked complete in ClickUp.

## Task 5 acceptance evidence

- Astra implemented shared deadline parsing/audiences, a protected server scheduler, atomic reminder receipts and preservation during client saves. Sol implemented the general deadline calendar/navigation and precise Cairo deadline inputs in creation and editing.
- Parent independently ran 82/82 cumulative tests, 2/2 additional date/receipt tests, lint and build. Invalid February rollover and lowercase ISO parsing issues found during review were corrected. Existing bundle-size warning remains.
- Browser in America/Los_Angeles at a fixed instant: member/content senior saw three content deadlines, production senior with admin tools saw only design/video, and Team Leader saw all five open deadlines. Future assignments, completed and archived tasks were excluded. Calendar links opened permitted task details and month navigation worked. No page/console errors in that matrix.
- A deadline at 2026-09-14T21:30Z appeared on September 15 at 00:30 Cairo. Editing to 01:45 saved 2026-09-14T22:45Z; creating a new task at 00:30 saved the original correct ISO instant and retained its workflow. Shared Drive metadata was mocked; no real file uploaded.
- Mobile viewport/document width both 390; calendar scroll stays inside its panel and the deadline lists remain readable. Screenshot: output/playwright/task05-calendar-mobile.png.
- Server-only tests exercise secret rejection, concurrent scheduler runs, concurrent task edits/completion/deadline changes, failed writes, repeated/cleared notifications, and signed client saves. Receipts and notices commit together; 24h/1h stages do not duplicate or send stale warnings.
- Production background reminders are not active until deployment and a minute-level trigger are configured. Linked Vercel team access returned 403, so its plan remains unverified. See docs/deadline-scheduler-deployment.md and vercel.cron-pro.example.json; no production configuration was changed.

## Task 6 acceptance evidence

- Astra implemented task visibility and edit/delete policies, canonical server authorization, explicit changed/deleted task IDs, filtered server responses, authenticated attachment metadata and private cache/poll isolation. Sol applied the policy to lists, counts, groups, cards, direct/upload links, comments/actions, calendars, reports and notices.
- Ordinary membership, creator-only relationships, handledBy, static reviewer lists and view-all settings do not grant future access. Seniors supervise current own-team work and retain senior scope despite admin tooling. Leadership has full task visibility. Actual uploads, approvals and work history allow historical read access; automatic started history does not.
- Parent independently ran 90/90 cumulative tests, 3/3 additional policy/notification/delay tests, lint and build. A final hidden member-blocker regression brought the suite to 91/91; worker reran lint/build after the final fixes. Build retains only the existing bundle-size warning.
- Local browser checks passed for dashboard, task list, notifications, future/creator-only/automatic-history/delayed direct-link denial and actual historical read access. No page errors in that matrix. Local Leave Account preserved all 12 canonical fixture tasks.
- Actual authenticated HTTP handler/browser: member saw only active own work and actual past uploads. Hidden descriptions/notices were absent; hidden history forgery and deletion returned 403. Partial saves retained all six canonical tasks and preserved hidden content; reload restored the correct view with no private tasks in IndexedDB.
- Two real UI uploads saved through the production handler: work to same-person next step generated one correct handoff notice; next upload to Art Director final retained two versions and historical read access, removed former-owner upload controls, and did not expose the Art Director notice. Drive metadata/files were mocked.
- A server clock change made a delayed task visible while its database revision stayed unchanged. The open browser refreshed and displayed it. Polls now refresh time-dependent visibility, guard in-flight edits, and reset private state on identity changes.
- Tests also cover real runtime returns/revisions/resets, forged peer attribution, on-behalf creation, explicit deletion and attachment URL/task-ID bypasses. Member-deletion blocking remains enforced without disclosing hidden task details.
- No production data, deployment or ClickUp status changes.


## Task 7 acceptance evidence

- Sol replaced task-facing Reject actions, confirmation, modal titles and error wording with Return terminology. Legacy rejected status renders Returned; known historical system templates are normalized for display while embedded task names remain exact.
- Parent reviewed the changes and required edit inputs to retain original stored comments. User-written feedback stays unchanged.
- Lint and build pass, retaining the existing bundle-size warning. No new permanent test was needed for this small copy change.
- Browser checks: comment confirmation asks to return for changes; historical AD notice displays returned while preserving QA Rejected Task Name; authored feedback containing rejected stays unchanged; legacy AD action and Return Task dialog use Return for Changes.
- No deployment, ClickUp changes or production writes.



## Task 8 acceptance evidence

- Astra implemented shared modern review normalization, compatible legacy names, input-boundary Content Rev. selection, consistent omission rules and terminal blocking when final AD approval is missing. Sol removed the redundant review route selector, added optional Content Review controls and protected final review in the builder.
- Parent reviewed and corrected two compatibility risks: legacy false content preference must not silently change a saved route, and custom work nodes must not inherit campaign-specific phase meanings. Saved skip IDs, disabled nodes, graph edges and explicit work kinds remain authoritative.
- Parent independently ran 97/97 tests, lint, diff check and final integrated build. Existing bundle-size warning remains. The six added tests include historical aliases, custom IDs, omission routing, legacy booleans, missing final approval and member-deletion blockers.
- Browser created two real assignments, included/omitted Content Rev., and confirmed persistence after reload. Real UI uploads advanced respectively to the content reviewer and First Rev.; each saved one version and exactly one next-owner notice. No page errors in these checks. Drive services were mocked.
- Browser final node cannot be deleted, disabled or demoted in the canvas/editor. New workflow persisted Work -> First Review -> Final Review with Art Director ownership. A first-click Edit layout bug found during review was fixed and retested.
- Active Content Rev. is not silently advanced by an ordinary assignment edit; leadership can explicitly Skip Step. Task 14 will implement broader active-phase omission/reconnection. Task 15 covers authenticated server enforcement against crafted terminal edits.
- No production writes, deployment or ClickUp status changes.
- Task 8 follow-up before task 9 edits: Astra found the generic CreateTask path passed the choice without reconciling skip IDs. addTask now applies the same explicit input-boundary helper. Parent created two generic submissions in the browser: include started Content Rev.; omit started First Rev.; each had one correct owner notice and one saved upload, retained after reload. Worker 97 tests/lint and parent final build passed. Task 9 was paused until this fix passed.


## Task 9 acceptance evidence

- Sol replaced global reviewer defaults with exact saved phase ownership in TaskDetail. Each parallel step has its own row; sequential current reviewer and previous approvals are separate. Header current owners are derived from actual action eligibility. Legacy tasks use actual current ownership.
- Parent reviewed paused/returned/closed states, legacy completed-history attribution and contradictory content-assignee metadata; those cases were corrected before acceptance.
- Browser parallel fixture: current owners were only the sequential next reviewer and the pending design reviewer; completed, delayed and unrelated global reviewers were excluded from current ownership. Final AD remained clearly upcoming. Content history showed the actual approver.
- Real UI pause/resume, final partial design approval and review-only return all passed. Completed design reviewer left current ownership; returned task named the resubmitter while its reviewer waited for resubmission. State survived reload.
- Browser delayed step became active at its availability time; completed task had no active owner; omitted content row said no reviewer needed. Legacy actual owner prevailed over unrelated defaults. Mobile width/document width both 390; no page errors in the tested matrix.
- Parent lint and production build passed. This display-only task used browser acceptance instead of duplicating implementation in unit tests; cumulative suite remains 97 tests. Existing bundle-size warning remains.
- No production changes, deployment or ClickUp status changes.

## Task 10 acceptance evidence

- Shared graph validation, canonical Unicode task-type names/collision checks, checked creation results, and server canonical-template validation are implemented. Seeded default campaign graph repairs preserve saved templates and task snapshots; only fresh seed uses the repaired route and single AD final gate.
- Parent created an Arabic-named workflow in the real builder, confirmed its Arabic type and explicit root survived persistence, and created an assignment. Breaking First Review's link in the real editor persisted the invalid draft and produced actionable builder diagnostics.
- Both new-task forms rejected the broken template and retained name/description or attached file. Generic submission succeeded after choosing a valid workflow. The existing assigned task's saved graph remained unchanged.
- Parent found and required correction of a new workflow's unconfigured Work step accepting only a general assignee but having no actual step owner. Both forms/store now materialize the explicitly selected contributors at creation only; explicit empty assignments and saved runtime semantics remain strict. All required future/delayed/conditional steps need real owners and feasible approval counts. Server enforces the same boundary with its canonical roster.
- Parent reran both creation forms: correct durable Work owner, invalid graphs and canonical collisions rejected without losing details/files, missing future owners named precisely with no task created. Generic creation succeeded after a valid selection. An actual assigned-work upload advanced to First Rev. using the unchanged saved snapshot after its canonical template was deliberately broken; reload preserved both the task snapshot and invalid draft. Zero page/console errors in passing checks.
- Parent independently ran all 106 tests, lint, diff check and production build. The existing bundle-size warning remains. Tests cover fresh-seed full execution/single AD gate, legacy arrays, multiple roots/joins, invalid drafts, return eligibility, Unicode collisions, server stale/new/forged initial graphs, owner materialization/explicit empties and member-deletion races.
- No production data changes, deployment or ClickUp status changes.

## Task 11 acceptance evidence

- Sol audited lifecycle derivation: only existing active workflow-owned types appear; stale aliases and metadata do not introduce choices. The small label change now shows the current workflow name beside a different task-type name while preserving stable IDs and explicit custom names.
- Parent browser created a new workflow and actual assignment, renamed it, disabled/re-enabled it, then deleted it. Each state survived reload; deletion also survived a deliberately stale settings response. Both new-task dropdowns excluded the deleted type. The assignment's saved snapshot remained exact throughout.
- Both dropdowns displayed the updated workflow name after rename; task-type ID stayed unchanged. Mobile width 390 had no horizontal overflow and the passing scenarios had no page errors.
- Worker task-type tests 10/10 passed; parent lint and production build passed, retaining the existing bundle-size warning. Full cumulative suite remains 106 tests; no duplicated UI-only tests were added.
- No production changes, deployment or ClickUp status changes.

## Task 12 acceptance evidence

- Astra implemented shared VO detection/provider validation, a durable delivery-owner map, real Shaza account resolution including Arabic names, legacy AI compatibility and changed-provider server validation. Sol integrated exactly Shaza/AI choices into builder defaults, both creation forms and assignment edits, with accurate canonical/legacy ownership in task details.
- Parent caught and required fixes for future VO coordinators inheriting unconfigured initial Work, omitted AI local/server validation disagreement, and replacing a VO workflow being blocked by its removed old provider fields. Explicit workContributorIds now keep initial ownership separate from aggregate future participants.
- Parent browser created Shaza and AI assignments; missing provider/uploader retained form fields and named the error. Neither future human could see either task until their own turn. Actual Designer uploads handed each task to its correct VO human; each human uploaded and handed it to First Rev. Other-provider tasks stayed hidden. Saved maps, snapshots and uploads survived reload.
- Generic creation passed with retained fields/file after failure, correct initial Designer owner and explicit AI delivery owner. Parent found a dropdown below the viewport after the extra controls lengthened the form; Sol fixed flipping/clamping/scrolling and parent retested real desktop/mobile selections at the viewport bottom.
- With no Shaza account, parent saved Shaza as a real builder default, verified it after reload, required an external delivery coordinator, and completed both uploads. The same Designer received exactly one new Record Voice Over handoff notification before moving to First Rev.
- Ordinary assignment edits preserved provider/owner/snapshot/current phase; explicitly selecting a different workflow replaced its cards/graph, restarted at the correct Designer root and retained both uploads. No page errors in the passing browser matrix.
- Parent independently ran all 112 tests, lint and production build. Existing bundle-size warning remains. AI generation is external; all Drive test links/metadata were mocked. No real audio service or external file was accessed.
- No production changes, deployment or ClickUp status changes.

## Task 13 acceptance evidence

- Sol renamed the Work step to Submit Internally Reviewed Assets and explained its upload action. Fresh seed describes the exact forward/return destinations; existing default templates receive a narrow stock-copy migration.
- Parent required conservative wording for custom/missing/disabled/multiple route targets and corrected a missing-target dereference before acceptance. Custom phase labels, instructions, graph and section copy remain intact.
- Parent browser verified the existing stock builder name/explanation before and after reload, custom template label/note preservation, and unchanged saved-task phase name/kind/history. No page errors in passing checks.
- Worker focused workflow tests passed 43/43 and idempotence/missing-target probes passed. Parent independently ran lint and production build after the final changes. Existing bundle warning remains; no new UI-only unit tests.
- No production changes, deployment or ClickUp status changes.

## Task 14 acceptance evidence

- Astra implemented shared leadership permission, omission validation and reconciliation; Sol added named Omit/Include cards to both creation forms, assignment edits and task details. Any nonfinal step may be omitted; the saved graph stays intact. Passed steps retain history and cannot be restored after the route has passed them. Existing explicit management permissions remain required for senior users.
- Parent reviewed and required fixes for work sessions carrying into a new step owned by the same person, suspended steps losing immediate handoff notices, new routes reaching ownerless legacy steps, and partially approved phases incorrectly displaying Completed.
- Parent browser created middle-step and all-nonfinal omissions (the latter starts at AD), tested generic creation/mobile and edited an existing active assignment. Persisted snapshots and initial/current owners were correct.
- A real Team Leader omitted/restored a future step, removed active steps, preserved a parallel join, omitted a held step and resumed it. No early held handoff; exactly one correct handoff after resume. Ordinary current owner had no omission controls. Local manual-account reload checks reauthenticated because those synthetic sessions are not durable; state preservation was verified separately.
- Actual Designer upload, First Reviewer return and second Designer upload routed around the omitted return target, retained both file versions and both completed-work history records, and left the omission intact. Upload mode exposed no omission controls.
- Actual authenticated HTTP handler rejected ordinary-owner skip-list and fabricated skipped-history mutations and a leader's final-AD omission with 403; canonical state remained unchanged. Real leader UI omission then persisted, survived signed-cookie reload, closed the old same-person work session, and produced exactly one new-step notification for that same owner.
- Parent independently ran all 121 tests, lint, diff check and production build. Existing bundle-size warning remains. No production changes, deployment or ClickUp status changes.
- ClickUp connector returned a rate limit during an optional task15 reread; all20 original descriptions/screenshots are already captured in the assessment, so implementation can continue from those records without rereading.

## Final verification and device instruction (user update)

- Continue through task20. After all individual acceptances, run a complete end-to-end flow and full regression checks. Fix failures and repeat the affected flow plus final checks until passing.
- Only after all required work and final checks pass, put this Windows device into sleep (user explicitly requested). Do not sleep on an incomplete/blocked task or failed test. Save all work and verification records before sleep.
- Codex Astra and Sol hit account usage limit during task15; neither task15 partial output is accepted. Switched to OpenCode Go Kimi K3 under existing model-choice authorization. Current job: D:/programming/national-care-opencode-runs/2026-09-13/task15-kimi-attempt01; brief task15-kimi-resume.md. CLI1.18.4 remains usable; optional1.18.30 update not applied. OpenCode health/inspection rerun; final ownership durability and transition validation still require completion and parent review.

### Final end-to-end verification plan

After task20 acceptance, execute a fresh complete role-based workflow through the authenticated local API: create/configure workflow and assignment, initial worker upload, Voice Over delivery, optional Content Review, First Review, AD return/revision cycle, and final approval. Include active/future reassignment, per-task omission, same-person handoff, precise visibility and roadmap ownership, reload persistence, and forbidden API actions. Recheck member removal/tombstones, workflow type lifecycle/saved snapshots, notification reset preservation, deadline background scheduler, and actual-work/manual daily reports at Cairo warning/auto-send boundaries using isolated fixtures. Run the complete permanent test suite, lint, production build and diff check; inspect unexpected browser/server errors and mobile layout. Repair any failures and repeat relevant flow before the final all-green run. Record results before invoking Windows sleep.

## Task 15 acceptance evidence

- Durable workflowFinalApproverIdsByPhaseId freezes one actual AD per mandatory phase. New assignment input cannot choose it; canonical old bindings survive ordinary edits/default/roster changes. Valid legacy bindings migrate from canonical prestate. Invalid frozen AD fails closed. Explicit execution replacement can bind a new configured AD; mere name/notes changes cannot.
- Canonical server transition checks reject terminal status-only changes, fabricated approval/history, skipped prerequisites, missing upload evidence, stripping workflow, disabling/demoting/clearing/reassigning final, zero approval count, wrong AD and archived-history promotion. Work must include new uploader evidence. On-behalf creation preserves legitimate attribution. Auto-archive cannot hide unfinished workflows.
- New routes must finish at AD. Old saved routes with Work after approval retain their graph/history but cannot silently finish; a workflow manager must repair the route. Normal explicit intermediate/custom review routes remain executable.
- Parent found and fixed new-map injection, blocked safe legacy migration, invalid-owner fallback, old-AD approval after a default change, and coerceTask dropping the new binding on reload. Final controls are read-only for all assignment users; authorized directly-to-AD tasks remain reachable in the assignment list.
- Actual API fixture rejected 13 forged changes with 403 and exact canonical state/revision unchanged. Real browser performed Work upload, next Work upload, wrong-AD denial, actual AD return, third revised upload, actual AD approval and reload. All three versions and review history persisted. Generic on-behalf creation with initial omitted steps persisted successfully.
- Local actual-admin creator test created an empty-template-owner assignment, changed default and added a second AD, checked old AD could approve while new AD could not, edited and saved with old fixed owner, and confirmed new form selects new default. Member read-only display and 390px mobile layout passed.
- Parent independently passed all136 permanent tests, TypeScript, diff check and production build (index-DUnWvsri.js; existing chunk warning only). All fixtures/Drive links isolated; no production writes/deploy/ClickUp changes.
- Native workers hit quota. Kimi attempts02/03 were stopped after inspection without delivery. MiniMax produced partial code, then stashed the shared checkout while investigating tests. Parent stopped it, applied stash@{0}, verified exact tracked equality against that stash, retained the recovery stash, and completed/reviewed corrections in Codex. Worker attempts remain revise; task acceptance reflects the corrected parent-reviewed implementation, not their unfinished outputs. No OpenCode worker remains running.

## Task 16 acceptance evidence

- Stock Approved? is now Art Director Review Outcome, an informational note explicitly requiring no extra approval. Existing stock executable decisions receive truthful Art Director Decision copy, keeping their kind, connections and custom review action intact. Exact custom labels/notes/instructions are preserved.
- Actual AD task detail explains approval versus Return for Changes; when configured successors exist it says continue to the configured next step, otherwise it explains final approval and posting readiness.
- Permanent migration/legacy/custom/idempotence test passed. Parent browser verified old-stock builder migration and reload, actual AD action/copy with no extra Approved? button, unchanged saved task snapshot and mobile width390. TypeScript passed. No production changes.

## Task 17 acceptance evidence

- Reset v3 records exact cleared notice IDs privately, atomically with the cleaned feed. Pre-v2 backlog clears once; a workspace already marked v2 retains its current feed because that marker cannot distinguish old from new notices. No repeated destructive reset of existing v2 activity.
- Shared API ignores incoming reset metadata, filters stale reintroduced IDs, preserves concurrently created notices and report/deadline delivery receipts, and hides private reset records from responses. Failed CAS commits no reset. Public settings retain only the version marker.
- Local IndexedDB loads/saves migrate atomically, retain reset receipts separately across cache clearing, filter stale payloads and retain new activity on stale pre-reset saves. Removed the React effect that could clear a newly loaded feed. Fresh first saves do not classify new notifications as backlog.
- Five permanent reset/persistence/API tests passed. Parent local browser verified legacy cleanup, new notice persistence, forged/stale reset metadata, cache clear/reload and unchanged one-time receipt. Parent actual HTTP browser signed in, completed cleanup, uploaded real synthetic work to produce a new same-person handoff notice, submitted a legitimate task edit with stale settings/old notification/forged receipt, and verified old notices stayed gone while the new notice survived and appeared after reload.
- All142 permanent tests, TypeScript, diff check and build passed. Existing bundle-size warning only. No production notifications were modified during isolated verification.

## Task 18 acceptance

Shared roadmap beneath TaskCard, Dashboard custom rows, ReviewQueue, AssignedWorkSection and both calendars uses saved snapshot and per-branch pending owners, frozen AD, return/delay/hold/closed state. Role gate also checks task visibility. Removed ungated assignment-card future-owner list. All 147 tests and TypeScript pass. verify-task18.js passed actual leader login, parallel/held cards, task rows, dashboard, both calendars, 390px mobile and ordinary-member exclusion with no page errors. Screenshot: output/playwright/task18-mobile.png. No production writes.

## Task 19 acceptance

Role-based leadership reassignment covers active and future step owners via a step selector and assignment editor. Mandatory frozen AD and completed steps stay protected. Durable per-person/per-step work sessions retain history and stop displaced workers without stopping parallel colleagues. Removal notices require actual work; future owners remain unnotified and hidden until activation. API derives removal/new-owner notices and rejects reassignment/history forgery. Queue start/finish state is per current member.

Local verify-task19-local.js passed leader active/future edit, stopped session, exact notices, fixed AD, reload via login, former-worker read-only view and mobile. verify-task19-http.js passed real UI PUT200/reload and future edit, former-worker/current-member/session forgery403 with unchanged canonical revisions, past-worker removal notice and future privacy. Re-ran all13 task15 HTTP forgery cases and full three-upload/return/AD approval flow; fixed semantic comparison of duplicate legacy contributor IDs and empty maps exposed by the upload test. 152 full tests plus new hydration regression pass; TypeScript and diff check pass. No production writes.

## Task 20 acceptance

Reports use actual work sessions, file submissions and review actions, with Cairo day/time boundaries and non-duplicated overlapping intervals. Assignment membership and automatic phase-start history alone do not count as work. Manual side work and time corrections preserve titles, time, durations and edit history through reload. The shared server scheduler warns at17:15 and submits nonempty reports at17:29 on Cairo working days, preserving hierarchy and exemptions. Atomic receipts survive clears/retries; no browser is needed for server execution.

Six permanent report/work/scheduler tests pass (summer/winter clocks, overnight, overlaps, unworked members, manual preservation, empty/exempt cases, concurrency/failure recovery). verify-task20-local.js passed actual work selection, side work,17:15/17:29, reload, correction and390px mobile. verify-task20-http.js passed UI save200, closed-app cron warning/send/idempotence, reload, correction200, stale-draft403 and leader read-only report with hidden-task snapshots. API fixture includes a past upload, correctly counted in addition to the session and manual work. Trigger/deployment limitation is documented in deadline-scheduler-deployment.md; no production changes.
