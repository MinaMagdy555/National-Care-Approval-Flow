# ClickUp assessment — 20 National Care edits

Assessed on 13 September 2026 against the current local checkout, HEAD `6bbc8cf`.

## Scope and evidence

Read all 20 tasks named 1–20 in the National Care list (901524484646), including their full descriptions and attachment metadata. Retrieved all 25 attached images: the 20 numbered screenshots and five identical copies of the additional workflow-builder screenshot. Inspected the 21 distinct images. All 20 tasks have no comments, checklists, dependencies, linked tasks, or subtasks in the connector response.

Reviewed the relevant workflow, assignment, reporting, calendar, user-management, notification, and shared-state code. Several requested changes already have partial implementations in the August 29–30 commits. Presence in code does not establish that a task is complete or deployed.

`npm run lint` passed (TypeScript compilation check). No browser acceptance tests, production data changes, deployment, or application edits were performed for this assessment. The pre-existing edits to Dashboard.tsx and appSettings.ts and the existing test-results folder were preserved.

## Understanding of every task

| ClickUp task | Required outcome | Current code and remaining assessment |
| --- | --- | --- |
| [1](https://app.clickup.com/t/86cbbkb28) | Execute the assigned workflow step by step; automatically activate the next step and notify its owner(s) only. | Workflow snapshots, active phases and transitions exist. Need to verify graph connections, parallel branches, revision loops, owner resolution and every notification path. Some code still falls back to array order or broad role membership. |
| [2](https://app.clickup.com/t/86cbbkb39) | Remove the old standalone task types shown in the screenshot; workflow definitions determine available types. | Workflow-owned types and cleanup logic exist. Check legacy mappings and saved settings cannot restore unwanted types. This shares implementation with 10 and 11. |
| [3](https://app.clickup.com/t/86cbbkb42) | Make member deletion work and persist. The original screenshot shows member rows, not task deletion. | Manual-member removal exists; another path deletes Supabase profiles. Verify removal survives reload and another device, errors are visible, and affected assignments are handled without orphaning active work. |
| [4](https://app.clickup.com/t/86cbbkb4p) | Daily reports go upward through the correct hierarchy: members to their own senior and leadership; senior reports to leadership; no peer/downward sharing. Apply leadership reporting exemptions. | The current recipient helper uses a workspace-wide list. The report screen excludes seniors from inspecting team reports. Both need a consistent team/role policy, including shared-data access. Team Leader reporting exemption is ambiguous in the description. |
| [5](https://app.clickup.com/t/86cbbkb5m) | General task deadline calendar and reminders; members/seniors see the work permitted for them and leadership sees team deadlines. | General deadline notifications partly exist, but the calendar still uses publishing dates. Need deadline views, permissions, reliable reminder timing, and handling of changed deadlines. Reminder lead time is unspecified. |
| [6](https://app.clickup.com/t/86cbbkb68) | Hide a task from a future worker until that worker's workflow step starts. | An active-owner visibility check exists, with creator and full-workspace exceptions. Audit every list, dashboard, task detail and notification entry point; clarify senior supervision access. |
| [7](https://app.clickup.com/t/86cbbkb7f) | Replace user-facing task wording “Rejected” with “Returned” throughout. | Main displayed labels appear substantially updated. Verify all task/report labels and historical messages. Legacy storage keys can remain compatible without displaying old wording. |
| [8](https://app.clickup.com/t/86cbbkb80) | Remove Quick Look / Full Review from the user flow; use optional Content Rev., First Rev. and Final Rev. | New stage names exist alongside legacy review values. Verify creation, transitions, queues, settings, old saved tasks and custom workflow nodes behave consistently. |
| [9](https://app.clickup.com/t/86cbbkb8k) | Show the exact person currently responsible for each review step. | Current-owner and reviewer displays exist. Check they show the active step owner rather than everyone eligible to review, especially for parallel steps. |
| [10](https://app.clickup.com/t/86cbbkb90) | Every workflow built in the builder appears as an assignable task type and executes exactly its configured flow. | Mapping and execution exist but need a single consistent interpretation of graph edges, decisions, optional steps and end states. Confirm the rule for already-running tasks when templates change. |
| [11](https://app.clickup.com/t/86cbbkb97) | The task-type dropdown contains only workflow-backed options. | Mostly present. Legacy and explicitly configured mappings need validation against active, existing workflows. Test create, rename, disable and delete persistence. |
| [12](https://app.clickup.com/t/86cbbkb9n) | Voice-over provider options are Shaza or AI only. | The dropdown exists. The Shaza choice is a placeholder identifier and needs a valid accountable owner; AI currently delegates to a content-team member. Clarify whether audio generation inside this app is wanted. |
| [13](https://app.clickup.com/t/86cbbkbbf) | Give “Any Internal Edits?” a clear name and explain what happens at that step. | The default template still uses that name. Proposed wording: “Review internal feedback: continue or return for edits,” with explicit outcomes. Existing workflow copies also need consideration. |
| [14](https://app.clickup.com/t/86cbbkbez) | Let leadership remove step cards while assigning/editing an individual task, while preserving a valid route. | Only steps already marked manually skippable can currently be omitted. Broader task-specific removal needs reconnection, progress preservation and handling of the current step. Required Art Director approval stays mandatory under task 15. |
| [15](https://app.clickup.com/t/86cbbkbfj) | Art Director review is mandatory and restricted to the Art Director, with the approver fixed automatically. | Required-approval and role-filtering logic exists. Verify all assignment/edit paths enforce it, the configured Art Director resolves correctly, and no skip/reassignment route bypasses it. |
| [16](https://app.clickup.com/t/86cbbkbfz) | Make the purpose of the “Approved?” step clear. | It is intended as the decision after Art Director review: ready for posting or return for edits. Prefer expressing this as the review outcome rather than asking the Art Director to perform an unexplained extra action; preserve explicit decision nodes where the custom workflow requires them. |
| [17](https://app.clickup.com/t/86cbbkbgp) | Clear the old notification backlog once, then retain new notifications normally. | A versioned one-time reset already exists. Check whether it has run and whether synchronization restores old notifications; do not blindly clear newer activity again. No notifications were cleared during assessment. |
| [18](https://app.clickup.com/t/86cbbkbhg) | Add a workflow roadmap below every task card/row showing current step and exact owner; visible only to leadership and seniors. | One card component has a current-step summary. Other task layouts differ; an assignment-card owner list is not gated the same way. Need a shared roadmap display and consistent role rules. |
| [19](https://app.clickup.com/t/86cbbkbja) | Leadership can reassign any step, including an active one. Stop the displaced worker's active work and notify them only if they had started. Notify every newly activated step, even if the same person owned the previous step. | Reassignment and same-person transition notifications partly exist. Current removal notices do not consistently check whether work started. Need per-person/per-step work state, current/future-step editing, accurate notices and cross-session persistence. |
| [20](https://app.clickup.com/t/86cbbkbk1) | Reports reflect actual work, allow manual additions, warn at 17:15 and auto-submit at 17:29. | Current warning uses a 20-minute window, potentially starting at 17:09. Auto-send runs in the signed-in browser, can create an empty report, and uses browser-local time. Work selection relies partly on task membership/current ownership; reliable per-step work history and manual side-work entries need attention. |

## Questions pending

1. Does the Team Leader submit a report upward to the Art Director/Marketing Manager, or are all three leadership roles exempt? Task 4 describes both leadership exemption and a Team Leader report.
2. Must reminders and 17:29 report submission run when everyone has closed the app? Proposed time zone: Africa/Cairo.
3. Should existing tasks retain their saved workflow when the template changes, with task-specific edits by leadership, or should all active tasks migrate immediately?
4. Does the AI voice-over option mean a person uses an external AI tool and uploads audio, or actual audio generation within this application?
5. Do seniors have supervision access to all tasks in their own team before their personal step becomes active, or follow the same active-step-only visibility as ordinary members?

Working assumptions to confirm during implementation: deadline reminders 24 hours and 1 hour before due time; reporting follows configured working days; Art Director approval cannot be removed; notification cleanup is a one-time reset of the legacy backlog; Shaza must resolve to a real account or an explicitly designated person who records delivery.

## Preliminary estimate of remaining work

This estimates my focused implementation and review time from the current checkout, rather than rebuilding all 20 requests from scratch. It is a planning range, not a measured completion guarantee.

| Work | Estimated hours |
| --- | ---: |
| Workflow execution, ownership, reassignment, visibility and task-specific step changes | 5–7 |
| Report hierarchy, work history/manual entries, deadline calendar and background scheduling | 5–7 |
| Task-type cleanup, user deletion, review labels, VO restrictions, roadmap and notification cleanup | 4–6 |
| Acceptance review, targeted logic tests, browser checks across roles and regression fixes | 6–10 |
| Contingency for shared-state, existing-data and integration issues | 4–6 |
| **Total** | **24–36** |

Approximately 3–5 full working days. Groups share code, so individual task counts are not additive estimates.

The estimate assumes background submission is required, notifications are in-app, existing tasks keep their snapshots unless individually edited, and AI audio is produced outside this application. Automatic migration of all running workflows or integrated AI audio generation needs a revised estimate. If reminders/submission only need to work while the app is open, the scheduling portion becomes smaller. Waiting for user decisions or unavailable service access is outside the active-work range.

## Review included in the estimate

- A task-by-task acceptance checklist covering all 20 requests.
- New and existing workflows, sequential/parallel steps, decisions, returns, optional-step removal, terminal states and mandatory final review.
- A → B handoff and A → A consecutive-step handoff; active and future reassignment; displaced worker who has and has not started.
- Member, senior, Team Leader, Art Director and Marketing Manager views, including direct task/report access and notification recipients.
- Reports with actual work, side work and manual edits; 17:15/17:29 boundaries, Cairo time, working days and duplicate prevention.
- Deadline reminders after deadline edits; notification cleanup after reload and another client reconnects.
- Member/workflow deletion and task-type options after reload and synchronization.
- TypeScript/build checks and desktop/mobile layout checks on an isolated test environment using test data.

## Main code locations examined

- `src/lib/store.tsx`: transition actions, notification recipients, report auto-send, member deletion and synchronization.
- `src/lib/workflowUtils.ts`: task visibility, owner resolution, workflow selection and phase semantics.
- `src/lib/appSettings.ts`: workflow templates, task-type derivation and settings migrations.
- `src/components/AssignedWorkSection.tsx`: workflow assignment cards, optional-step controls, VO and Art Director selectors.
- `src/components/TaskDetail.tsx`, `TaskCard.tsx`, `ReviewQueue.tsx`, `Dashboard.tsx`, `App.tsx`: current owner, permissions, reassignment, roadmap and task lists.
- `src/components/DailyReports.tsx`: report audience, row selection, editing and submission.
- `src/components/CampaignScheduler.tsx`: current publishing-date calendar.
- `api/app-state.ts`, `src/lib/neonDb.ts`: shared-state access and persistence. The current API returns a combined state document; permission changes must be considered in data access as well as rendering.
