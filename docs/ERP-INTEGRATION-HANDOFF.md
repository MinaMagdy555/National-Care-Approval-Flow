# National Care Approval Flow — ERP Engineering Handoff

Prepared: 2026-11-16
Original project: https://github.com/MinaMagdy555/National-Care-Approval-Flow
Handoff branch: handoff/erp-integration-2026-11-16
Source: main at 372df93b4f6f81c11ea5e608246727eb57e23c8f

## Purpose
Technical evaluation and integration of the existing National Care Approval Flow with the company's ERP. This handoff branch is separate from main and does not modify the application implementation.

## Access
This repository is public. Anyone can view and clone its source, but viewers without write permission cannot push changes to the original repository. Public source cannot be protected against copying. Do not grant collaborator write access solely to enable reading.

Browse:
https://github.com/MinaMagdy555/National-Care-Approval-Flow/tree/handoff/erp-integration-2026-11-16

Clone:
```bash
git clone --branch handoff/erp-integration-2026-11-16 --single-branch https://github.com/MinaMagdy555/National-Care-Approval-Flow.git
cd National-Care-Approval-Flow
npm ci
npm run lint
npm test
npm run dev
```

## Start with these files
- README.md — overview, workspace setup, local run and deployment context.
- docs/project-documentation.md — architecture, data types, workflow logic, persistence and API descriptions.
- docs/deadline-scheduler-deployment.md — conditions for scheduled reminders and daily reports.
- .env.example — configuration variable names and non-production examples.

## Integration map
| Area | Source | ERP engineering focus |
| --- | --- | --- |
| Interface | src/App.tsx, src/components | Embedding or front-end integration decision |
| Workflows | src/lib/workflowRuntime.ts, src/lib/workflowGraph.ts | Approval and status mappings |
| Task model | src/lib/types.ts | ERP entities and identifiers |
| State | src/lib/store.tsx, api/app-state.ts | Source of truth, concurrency, sync |
| Authorization | src/lib/taskPolicy.ts, server/workspaceAuth.ts | SSO, role mapping and access boundaries |
| Attachments | src/lib/driveAuth.ts, src/lib/driveDb.ts | Storage, permissions and transfer |
| Notifications | api/cron/deadline-reminders.ts | Scheduler activation and duplicate prevention |

## Existing application endpoints
- GET /api/app-state: authorized, filtered state.
- GET /api/app-state?meta=1: state update metadata.
- GET /api/app-state?settings=1: public settings.
- GET /api/app-state?auth=session: workspace session.
- POST /api/app-state?auth=login: workspace login.
- POST /api/app-state?auth=logout: logout.
- PUT /api/app-state: access-checked state update; do not send ERP production bulk updates before reviewing server-side merging.
- GET /api/metadata: authorized link metadata.
- GET or POST /api/cron/deadline-reminders: scheduled notification and report handling with privileged authorization.

These are application APIs, not a confirmed ERP integration contract. Create a controlled adapter rather than directly writing into production tables.

## Account access and handover
The project README currently contains account setup information. Do not assume publicly committed credentials are secure or appropriate for ERP or production access. Preserve business account requirements for the integration engineer, but issue dedicated, least-privilege testing/integration accounts and distribute live credentials through a private company-approved channel.

Never commit actual database connection credentials, email app passwords, privileged backend tokens, cron secrets, or local production environment files. The repository's .env.example contains illustrative values only.

## Validation and go-live gates
1. Review task and workflow identity, lifecycle and permissions.
2. Define ERP and project source-of-truth boundaries and authentication mapping.
3. Develop and test an adapter in staging using separate integration credentials.
4. Verify approval/rejection branching, task visibility, uploads, synchronization conflicts, deadlines, daily reports and rollback behavior.
5. Obtain project owner and ERP administrator approval before production deployment.

Status: technical evaluation handoff. No ERP credentials, production deployment, or integration implementation included.
