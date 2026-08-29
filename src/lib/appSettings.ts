import { AppSettings, Priority, PriorityOption, PriorityTone, ResponsibilityOption, Role, TaskType, User, TaskTypeConfig, CustomWorkingHours, WorkflowDefinition, WorkflowPhaseDefinition } from './types';

export const MINA_ID = '83e02bb4-11f9-41b0-becb-33e6c4c52b2a';
export const MARWA_ID = 'd65ea68d-1749-45b9-b0f9-1fdaf23b8f94';
export const DINA_ID = '094d2844-ca2f-401b-8819-b464eace00d2';
export const MARIAM_ID = 'e0489354-0692-4781-b5cb-b343fd7d278f';
export const NOREEN_ID = '007c342a-a023-4dcf-844d-c3945c5e27e0';
export const YOMNA_ID = '8410313e-ed44-43f2-bc74-69d75c53012b';
export const FAWZY_ID = '6d7f8829-23f3-40d3-ba30-b079fda01899';
export const OMAR_ID = 'c78ab974-1a47-468f-93b8-a3ebfc4cfdc3';
export const AHMED_SOBEEH_ID = '697a804f-d7b0-4edb-9a0a-b42f0e7f8b53';
export const SAMA_ID = '2baf5b98-3788-4bec-a3e4-6d7cfe32c637';
export const HANEEN_ID = 'c4274078-418a-47b9-a2be-98e75ed89aae';
export const REEM_ID = 'e620c5ca-fd56-45ba-99a1-33b56be69e48';

const now = new Date().toISOString();

export const FULL_REVIEW_WORKFLOW_ID = 'workflow_full_review_default';
export const QUICK_LOOK_WORKFLOW_ID = 'workflow_quick_look_default';
export const SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID = 'workflow_social_media_campaigns_default';

function campaignPhase(
  id: string,
  name: string,
  parentPhaseId: string | null,
  parentPhaseIds: string[],
  nodeX: number,
  nodeY: number,
  responsibilityIds: string[],
  instructions: string,
  mode: 'sequential' | 'parallel' = 'sequential',
  reviewStyle: 'quick_look' | 'full_review' | 'final_approval' = 'quick_look',
  roleIds: Role[] = [],
  returnToPhaseId: string | null = null,
  subPhases: WorkflowDefinition['phases'][number]['subPhases'] = [],
  skipRule: WorkflowDefinition['phases'][number]['skipRule'] = 'none',
): WorkflowDefinition['phases'][number] {
  const phaseKind = reviewStyle === 'final_approval'
    ? 'final_review'
    : reviewStyle === 'full_review'
      ? 'first_review'
      : /content.*review/i.test(name)
        ? 'content_review'
        : 'work';
  return {
    id,
    name,
    phaseKind,
    reviewStyle,
    mode,
    userIds: [],
    roleIds,
    responsibilityIds,
    instructions,
    deliverables: [],
    delayDays: null,
    maxRevisionRounds: null,
    skipCondition: '',
    skipRule,
    returnToPhaseId,
    requiredApprovals: null,
    parentPhaseId,
    parentPhaseIds,
    nodeX,
    nodeY,
    nodeType: 'step',
    disabled: false,
    nodeNote: instructions,
    subPhases,
  };
}

function campaignSection(
  id: string,
  name: string,
  nodeX: number,
  nodeY: number,
  nodeWidth: number,
  nodeHeight: number,
  sectionColor: string,
  note: string,
): WorkflowDefinition['phases'][number] {
  return {
    id,
    name,
    reviewStyle: 'quick_look',
    mode: 'sequential',
    userIds: [],
    roleIds: [],
    responsibilityIds: [],
    instructions: note,
    deliverables: [],
    delayDays: null,
    maxRevisionRounds: null,
    skipCondition: '',
    returnToPhaseId: null,
    requiredApprovals: null,
    parentPhaseId: null,
    parentPhaseIds: [],
    nodeX,
    nodeY,
    nodeWidth,
    nodeHeight,
    nodeType: 'section',
    disabled: false,
    nodeNote: note,
    sectionColor,
    subPhases: [],
  };
}

function campaignNote(
  id: string,
  name: string,
  nodeX: number,
  nodeY: number,
  nodeWidth: number,
  nodeHeight: number,
  note: string,
): WorkflowDefinition['phases'][number] {
  return {
    ...campaignSection(id, name, nodeX, nodeY, nodeWidth, nodeHeight, '#f97316', note),
    nodeType: 'note',
    sectionColor: '#f97316',
  };
}

const seededWorkflows: WorkflowDefinition[] = [
  {
    id: SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID,
    name: 'Social Media Campaigns',
    description: 'Campaign structure, parallel video/design production, internal review, art director approval, and ready-for-posting status.',
    active: true,
    createdAt: now,
    updatedAt: now,
    rootNodeX: 520,
    rootNodeY: 30,
    taskTypeIds: ['campaign'],
    phases: [
      campaignPhase(
        'campaign_structure',
        'Campaign Structure',
        'workflow-root',
        ['workflow-root'],
        520,
        180,
        ['content_creator'],
        'Content team builds the campaign structure: posts, reels, stories, covers, mockups, platforms, timing, and duration.',
      ),
      campaignPhase(
        'final_structure_meeting',
        'Final Structure Meeting',
        'campaign_structure',
        ['campaign_structure'],
        520,
        330,
        ['content_creator', 'team_leader'],
        'Content team and team leader review the structure together and agree what moves forward.',
      ),
      campaignPhase(
        'write_content',
        'Write Content',
        'final_structure_meeting',
        ['final_structure_meeting'],
        520,
        480,
        ['content_creator'],
        'Write captions, TOV, shooting list, scripts, and campaign content notes.',
        'sequential',
        'quick_look',
        [],
        null,
        [
          { id: 'write_content_captions', title: 'Content', note: 'Captions, post copy, stories, and campaign text.', responsibilityIds: ['content_creator'] },
          { id: 'write_content_shooting_list', title: 'Shooting List', note: 'Define what should be shot for reels, stories, and product material.', responsibilityIds: ['content_creator'] },
          { id: 'write_content_scripts', title: 'Scripts', note: 'Scripts and TOV for reels and voice over when needed.', responsibilityIds: ['content_creator'] },
        ],
      ),
      campaignPhase(
        'shooting',
        'Shooting',
        'write_content',
        ['write_content'],
        170,
        760,
        ['content_creator'],
        'Video production starts with shooting the required campaign material.',
        'parallel',
      ),
      campaignPhase(
        'brief_reels_scripts_tov',
        'Brief Reels, Scripts and Tone of Voice',
        'shooting',
        ['shooting'],
        170,
        910,
        ['content_creator'],
        'Content team prepares reel briefs, voice-over scripts, and tone of voice notes for production.',
        'sequential',
      ),
      campaignPhase(
        'voice_over_optional',
        'Voice Over',
        'brief_reels_scripts_tov',
        ['brief_reels_scripts_tov'],
        170,
        1060,
        ['voice_over'],
        'Optional voice-over step for Shaza when campaign reels need VO.',
        'sequential',
        'quick_look',
        [],
        null,
        [],
        'manual',
      ),
      campaignPhase(
        'montage',
        'Montage',
        'voice_over_optional',
        ['voice_over_optional'],
        170,
        1210,
        ['video_editor'],
        'Video editors create the campaign reel/video montage.',
        'sequential',
      ),
      campaignPhase(
        'final_creative',
        'Final Creative',
        'montage',
        ['montage'],
        170,
        1360,
        ['content_creator'],
        'Content team collects final creative assets into the final creative sheet.',
        'sequential',
      ),
      campaignPhase(
        'design',
        'Design',
        'write_content',
        ['write_content'],
        920,
        760,
        ['graphic_designer'],
        'Graphic designers create campaign posts, stories, reel covers, carousel covers, thumbnails, and related designs.',
        'parallel',
      ),
      campaignPhase(
        'mockups',
        'Mockups',
        'design',
        ['design'],
        920,
        910,
        ['graphic_designer'],
        'Create mockups when needed for posts, stories, reel covers, carousels, thumbnails, and full campaign previews.',
        'sequential',
      ),
      campaignPhase(
        'content_team_review',
        'Content Team Review',
        'final_creative',
        ['final_creative', 'mockups'],
        450,
        1240,
        ['content_creator'],
        'Content team reviews all assets and can request modifications.',
        'parallel',
        'quick_look',
      ),
      campaignPhase(
        'senior_video_editor_review',
        'Senior Video Editor Review',
        'final_creative',
        ['final_creative', 'mockups'],
        750,
        1240,
        ['senior_brand_designer_video_editor'],
        'Senior video editor fully reviews reels and gives quick comments on graphics.',
        'parallel',
        'full_review',
        ['reviewer'],
      ),
      campaignPhase(
        'any_internal_edits',
        'Any Internal Edits?',
        'content_team_review',
        ['content_team_review', 'senior_video_editor_review'],
        600,
        1460,
        ['content_creator', 'senior_brand_designer_video_editor'],
        'Decision point: if internal comments exist, route edits to the correct creative owner; if not, notify senior video editor.',
        'sequential',
        'quick_look',
        [],
        'making_internal_edits',
      ),
      campaignPhase(
        'making_internal_edits',
        'Making Edits',
        'any_internal_edits',
        ['any_internal_edits'],
        260,
        1580,
        ['graphic_designer', 'video_editor'],
        'Graphic designers and video editors make requested internal edits, then the work loops back for content/senior review.',
        'sequential',
        'quick_look',
        [],
        'content_team_review',
      ),
      campaignPhase(
        'content_team_review_loop',
        'Recheck Revised Assets',
        'making_internal_edits',
        ['making_internal_edits'],
        260,
        1760,
        ['content_creator'],
        'Loop until both content team and senior video editor approve the internal edits.',
        'sequential',
        'quick_look',
        [],
        'content_team_review',
      ),
      campaignPhase(
        'notify_senior_video_editor',
        'Notify Senior Video Editor',
        'any_internal_edits',
        ['any_internal_edits'],
        940,
        1560,
        ['senior_brand_designer_video_editor'],
        'Notify senior video editor with campaign name, platform, date/month, and pending approval scope: reels, posts, stories, reel covers, mockups, or all deliverables.',
        'sequential',
        'quick_look',
        ['reviewer'],
      ),
      campaignPhase(
        'submit_to_art_director',
        'Submit Campaign for Art Director Approval',
        'notify_senior_video_editor',
        ['notify_senior_video_editor'],
        940,
        1710,
        ['senior_brand_designer_video_editor'],
        'Senior video editor submits the campaign to the art director for final approval.',
        'sequential',
        'final_approval',
        ['reviewer'],
      ),
      campaignPhase(
        'art_director_review',
        'Final Art Director Approval',
        'submit_to_art_director',
        ['submit_to_art_director', 'making_art_director_edits'],
        940,
        1860,
        ['art_director'],
        'Art director performs the final campaign review before posting readiness.',
        'sequential',
        'final_approval',
        ['art_director'],
      ),
      campaignPhase(
        'approved',
        'Approved?',
        'art_director_review',
        ['art_director_review'],
        940,
        2010,
        ['art_director'],
        'Decision point: approved campaigns move to ready for posting; returned campaigns go back for edits.',
        'sequential',
        'final_approval',
        ['art_director'],
        'making_art_director_edits',
      ),
      campaignPhase(
        'making_art_director_edits',
        'Making Edits',
        'approved',
        ['approved'],
        620,
        2140,
        ['graphic_designer', 'video_editor'],
        'Apply art director comments. Design comments return to graphic designers; video comments return to video editors.',
        'sequential',
        'quick_look',
        [],
        'art_director_review',
      ),
      campaignPhase(
        'ready_for_posting',
        'Ready For Posting',
        'approved',
        ['approved'],
        1260,
        2140,
        ['art_director', 'team_leader'],
        'Status only: update art director and team leader that the campaign is ready for posting.',
        'sequential',
        'final_approval',
        ['art_director', 'team_leader'],
      ),
      campaignSection(
        'section_video_production',
        'Video Production',
        135,
        710,
        340,
        785,
        '#16a34a',
        'Parallel production lane for shooting, reel briefs, voice-over, montage, and final creative.',
      ),
      campaignSection(
        'section_design_production',
        'Design Production',
        890,
        710,
        400,
        390,
        '#d946ef',
        'Parallel production lane for designs and optional mockups including posts, stories, reel covers, carousels, thumbnails, and mockups.',
      ),
      campaignSection(
        'section_internal_review',
        'Internal Review Stage',
        420,
        1200,
        650,
        200,
        '#f59e0b',
        'Content team and senior video editor review in parallel before the internal edits decision.',
      ),
      campaignNote(
        'note_legend',
        'Legend',
        40,
        1540,
        230,
        230,
        'Content Team | Graphic Designers | Video Editors | Senior Video Editor | Art Director | Voice Over (Shaza) | Decision Point | Optional / Includes | Loop / Revision',
      ),
      campaignNote(
        'note_key_notes',
        'Key Notes',
        40,
        1810,
        300,
        245,
        'Voice Over is only if needed. Senior Video Editor reviews in parallel with Content Team. Internal loop continues until both approve. Art Director review is the final approval before Ready For Posting.',
      ),
    ],
  },
  {
    id: FULL_REVIEW_WORKFLOW_ID,
    name: 'Full Review',
    description: 'Content review, senior full review, then final approval.',
    active: true,
    createdAt: now,
    updatedAt: now,
    phases: [
      {
        id: 'content_review',
        name: 'Content Review',
        reviewStyle: 'quick_look',
        mode: 'parallel',
        userIds: [],
        roleIds: [],
        responsibilityIds: ['content_creator'],
      },
      {
        id: 'senior_full_review',
        name: 'Senior Branding & Video Editing',
        reviewStyle: 'full_review',
        mode: 'parallel',
        userIds: [],
        roleIds: ['reviewer'],
        responsibilityIds: ['senior_brand_designer_video_editor'],
      },
      {
        id: 'art_director_final',
        name: 'Art Director',
        reviewStyle: 'final_approval',
        mode: 'parallel',
        userIds: [],
        roleIds: ['art_director'],
        responsibilityIds: ['art_director'],
      },
    ],
  },
  {
    id: QUICK_LOOK_WORKFLOW_ID,
    name: 'Quick Look',
    description: 'Content review, senior quick look, then final approval.',
    active: true,
    createdAt: now,
    updatedAt: now,
    phases: [
      {
        id: 'content_review',
        name: 'Content Review',
        reviewStyle: 'quick_look',
        mode: 'parallel',
        userIds: [],
        roleIds: [],
        responsibilityIds: ['content_creator'],
      },
      {
        id: 'senior_quick_look',
        name: 'Senior Branding & Video Editing',
        reviewStyle: 'quick_look',
        mode: 'parallel',
        userIds: [],
        roleIds: ['reviewer'],
        responsibilityIds: ['senior_brand_designer_video_editor'],
      },
      {
        id: 'art_director_final',
        name: 'Art Director',
        reviewStyle: 'final_approval',
        mode: 'parallel',
        userIds: [],
        roleIds: ['art_director'],
        responsibilityIds: ['art_director'],
      },
    ],
  },
];

// Only the production campaign workflow is introduced to a new workspace.
// Older generic presets are retained above solely for old task snapshots.
export const defaultWorkflows: WorkflowDefinition[] = seededWorkflows.filter(
  workflow => workflow.id === SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID,
);

export function getDefaultWorkflowIdForTaskType(taskType: string): string | null {
  const clean = cleanTaskTypeKey(taskType);
  if (clean === 'campaign' || clean === 'social media campaign' || clean === 'social media campaigns') {
    return SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
  }
  return null;
}

export const defaultResponsibilities: ResponsibilityOption[] = [
  { id: 'senior_brand_designer_video_editor', label: 'Senior Brand Designer & Video Editor', permissionRole: 'reviewer' },
  { id: 'art_director', label: 'Art Director', permissionRole: 'art_director' },
  { id: 'team_leader', label: 'Team Leader', permissionRole: 'team_leader' },
  { id: 'manager', label: 'Manager', permissionRole: 'manager' },
  { id: 'developer', label: 'Developer', permissionRole: 'developer' },
  { id: 'marketing_manager', label: 'Marketing Manager', permissionRole: 'marketing_manager' },
  { id: 'graphic_designer', label: 'Graphic Designer', permissionRole: 'team_member' },
  { id: 'video_editor', label: 'Video Editor', permissionRole: 'team_member' },
  { id: 'senior_content_creator', label: 'Senior Content Creator', permissionRole: 'team_member' },
  { id: 'content_creator', label: 'Content Creator', permissionRole: 'team_member' },
  { id: 'voice_over', label: 'Voice Over', permissionRole: 'team_member' },
  { id: 'hr', label: 'HR', permissionRole: 'team_member', grantsSettingsAccess: true },
  { id: 'admin', label: 'Admin', permissionRole: 'admin', grantsSettingsAccess: true },
];

export const defaultPriorities: PriorityOption[] = [
  { id: 'low', label: 'Low', tone: 'emerald', sortOrder: 3, active: true },
  { id: 'normal', label: 'Normal', tone: 'slate', sortOrder: 2, active: true },
  { id: 'high', label: 'High', tone: 'amber', sortOrder: 1, active: true },
  { id: 'urgent', label: 'Urgent', tone: 'rose', sortOrder: 0, active: true },
];

export const defaultAppSettings: AppSettings = {
  responsibilities: defaultResponsibilities,
  manualUsers: [],
  priorities: defaultPriorities,
  businessCalendar: {
    timezone: 'Africa/Cairo',
    workdays: [0, 1, 2, 3, 4],
    startTime: '09:00',
    endTime: '17:30',
  },
  settingsManagerUserIds: [MINA_ID, FAWZY_ID, AHMED_SOBEEH_ID],
  settingsManagerResponsibilityIds: ['hr', 'admin'],
  workAssignmentCreatorIds: [DINA_ID, MARWA_ID, AHMED_SOBEEH_ID, FAWZY_ID],
  contributorAssignerIds: [MINA_ID, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID],
  neverHandlerIds: [OMAR_ID, FAWZY_ID, MARWA_ID, AHMED_SOBEEH_ID],
  selfAssignmentBlockedIds: [MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID],
  videoOnlyHandlerIds: [YOMNA_ID],
  alwaysAssignableHandlerIds: [MINA_ID],
  firstReviewerUserIds: [MINA_ID],
  finalReviewerUserIds: [MARWA_ID],
  viewAllWorkloadUserIds: [MINA_ID, MARWA_ID, DINA_ID, AHMED_SOBEEH_ID, FAWZY_ID],
  flowLabels: {
    reviewerQueue: 'Waiting for First Rev.',
    artDirectorQueue: 'Waiting for Final Rev.',
    uploadTask: 'Upload Task',
    assignedWork: 'Assign a Task',
  },
  customPermissions: [],
  // Task types now belong to a workflow and are created in Workflow Builder.
  taskTypes: [],
  workflows: defaultWorkflows,
  deletedWorkflowIds: [],
  defaultWorkflowId: SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID,
  taskTypeWorkflowIds: {},
  campaignPlatforms: ['Instagram', 'LinkedIn', 'TikTok', 'Snapchat'],
  hiddenColumns: [],
  customWorkingHours: [],
  updatedAt: now,
};

export function normalizeSettingId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `custom_${Date.now().toString(36)}`;
}

export function normalizeTaskTypeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .replace(/\s+/g, ' ') || `custom_${Date.now().toString(36)}`;
}

export function cleanTaskTypeKey(type: string): string {
  if (!type) return '';
  return type.toLowerCase().replace(/_/g, ' ').trim();
}

function getTaskTypeLabelSimple(type: string): string {
  if (!type) return 'Asset';
  const clean = cleanTaskTypeKey(type);
  switch (clean) {
    case 'video': return 'Video';
    case 'ai packet': return 'AI Packets';
    case 'sales material': return 'Sales Material';
    case 'website material': return 'Website Material';
    case 'campaign': return 'Campaign';
    case 'write content': return 'Write Content';
    case 'write caption': return 'Write Caption';
    case 'reels voice over script': return 'Reels Voice Over Script';
    case 'others': return 'Others';
    default: {
      return clean
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  }
}

export function getTaskTypeConfigs(settings: AppSettings): TaskTypeConfig[] {
  const canonicalTaskTypeId = (id: string) => {
    const normalized = cleanTaskTypeKey(id);
    return normalized === 'social media campaign' || normalized === 'social media campaigns'
      ? 'campaign'
      : id;
  };
  const workflowTypes = (settings.workflows || []).flatMap(workflow => (
    (workflow.taskTypeIds || []).map(id => ({ id: canonicalTaskTypeId(id), workflowId: workflow.id }))
  ));
  const mappedLegacyTypes = Object.entries(settings.taskTypeWorkflowIds || {})
    .filter(([, workflowId]) => (settings.workflows || []).some(workflow => workflow.id === workflowId))
    .map(([id, workflowId]) => ({ id: canonicalTaskTypeId(id), workflowId }));
  const explicitWorkflowTypes = (settings.taskTypes || [])
    .filter((item): item is TaskTypeConfig => (
      typeof item === 'object' && item !== null && Boolean((item as TaskTypeConfig).workflowId)
    ))
    .map(item => ({ ...item, id: canonicalTaskTypeId(item.id) }));
  const types: Array<string | TaskTypeConfig> = [
    ...workflowTypes.map(item => ({ id: item.id, label: getTaskTypeLabelSimple(item.id), suggestedJobTitles: [], isDetailedReview: false, workflowId: item.workflowId })),
    ...mappedLegacyTypes.map(item => ({ id: item.id, label: getTaskTypeLabelSimple(item.id), suggestedJobTitles: [], isDetailedReview: false, workflowId: item.workflowId })),
    ...explicitWorkflowTypes,
  ];
  const seen = new Set<string>();
  return types.filter(item => {
    const id = typeof item === 'string' ? item : item.id;
    const key = cleanTaskTypeKey(id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(t => {
    if (typeof t === 'object' && t !== null) {
      return {
        id: (t as any).id,
        label: (t as any).label || getTaskTypeLabelSimple((t as any).id),
        suggestedJobTitles: Array.isArray((t as any).suggestedJobTitles) ? (t as any).suggestedJobTitles : [],
        isDetailedReview: typeof (t as any).isDetailedReview === 'boolean' ? (t as any).isDetailedReview : false,
        fullReviewerUserIds: Array.isArray((t as any).fullReviewerUserIds) ? (t as any).fullReviewerUserIds : [],
        quickLookUserIds: Array.isArray((t as any).quickLookUserIds) ? (t as any).quickLookUserIds : [],
        finalReviewerUserIds: Array.isArray((t as any).finalReviewerUserIds) ? (t as any).finalReviewerUserIds : [],
        workflowId: typeof (t as any).workflowId === 'string' ? (t as any).workflowId : null,
      };
    }
    
    const id = String(t);
    const label = getTaskTypeLabelSimple(id);
    const cleanId = cleanTaskTypeKey(id);
    let suggestedJobTitles: string[] = [];
    let isDetailedReview = false;

    if (cleanId === 'video') {
      suggestedJobTitles = ['Video Editor', 'Senior Brand Designer & Video Editor'];
      isDetailedReview = true;
    } else if (['write content', 'write caption', 'reels voice over script'].includes(cleanId)) {
      suggestedJobTitles = ['Content Creator'];
      isDetailedReview = false;
    } else if (cleanId === 'ai packet') {
      suggestedJobTitles = ['Graphic Designer', 'Senior Brand Designer & Video Editor'];
      isDetailedReview = true;
    } else {
      suggestedJobTitles = ['Graphic Designer', 'Senior Brand Designer & Video Editor'];
      isDetailedReview = false;
    }

    return {
      id,
      label,
      suggestedJobTitles,
      isDetailedReview,
      fullReviewerUserIds: [],
      quickLookUserIds: [],
      finalReviewerUserIds: [],
      workflowId: null,
    };
  });
}

export function mergeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const taskTypeCleanupVersion = typeof settings?.taskTypeCleanupVersion === 'number'
    ? settings.taskTypeCleanupVersion
    : 0;
  // Version 2 also removes legacy TaskTypeConfig objects. Version 1 removed
  // only their workflow mapping, leaving old testing types selectable in some
  // persisted workspaces.
  const shouldRemovePrototypeTaskTypes = taskTypeCleanupVersion < 2;
  const prototypeTaskTypeIds = new Set([
    'video', 'ai packet', 'new product', 'new products', 'sales material',
    'website material', 'write content', 'write caption', 'reels voice over script', 'others',
  ]);
  const isPrototypeTaskType = (id: string) => prototypeTaskTypeIds.has(cleanTaskTypeKey(id));
  const priorities = Array.isArray(settings?.priorities) && settings.priorities.length > 0
    ? settings.priorities
    : defaultAppSettings.priorities;
  const responsibilityById = new Map<string, ResponsibilityOption>();
  defaultAppSettings.responsibilities.forEach(responsibility => responsibilityById.set(responsibility.id, responsibility));
  if (Array.isArray(settings?.responsibilities)) {
    settings.responsibilities.forEach(responsibility => {
      if (!responsibility?.id) return;
      responsibilityById.set(responsibility.id, {
        ...responsibility,
        label: responsibility.id === 'art_director' || responsibility.label === 'Final Approvement' || responsibility.label === 'Art Director' ? 'Art Director' : responsibility.label,
      });
    });
  }
  const responsibilities = Array.from(responsibilityById.values());
  const manualUsers = Array.isArray(settings?.manualUsers)
    ? settings.manualUsers.filter((user): user is User => Boolean(user?.id && user?.name))
    : [];

  let workAssignmentCreatorIds = Array.isArray(settings?.workAssignmentCreatorIds) ? settings.workAssignmentCreatorIds : defaultAppSettings.workAssignmentCreatorIds;
  let neverHandlerIds = Array.isArray(settings?.neverHandlerIds) ? settings.neverHandlerIds : defaultAppSettings.neverHandlerIds;
  let selfAssignmentBlockedIds = Array.isArray(settings?.selfAssignmentBlockedIds) ? settings.selfAssignmentBlockedIds : defaultAppSettings.selfAssignmentBlockedIds;
  let firstReviewerUserIds = Array.isArray(settings?.firstReviewerUserIds) ? settings.firstReviewerUserIds : defaultAppSettings.firstReviewerUserIds || [];
  let finalReviewerUserIds = Array.isArray(settings?.finalReviewerUserIds) ? settings.finalReviewerUserIds : defaultAppSettings.finalReviewerUserIds || [];
  let viewAllWorkloadUserIds = Array.isArray(settings?.viewAllWorkloadUserIds) ? settings.viewAllWorkloadUserIds : defaultAppSettings.viewAllWorkloadUserIds || [];
  const deletedWorkflowIds = Array.isArray(settings?.deletedWorkflowIds)
    ? Array.from(new Set(settings.deletedWorkflowIds.filter((id): id is string => typeof id === 'string' && Boolean(id))))
    : [];
  const deletedWorkflowIdSet = new Set(deletedWorkflowIds);
  // Seed defaults only for a genuinely new workspace. Once a workflow has been
  // deleted, an explicitly saved workflow list must never recreate it.
  const incomingWorkflows = Array.isArray(settings?.workflows)
    ? settings.workflows.filter(workflow => ![FULL_REVIEW_WORKFLOW_ID, QUICK_LOOK_WORKFLOW_ID].includes(workflow.id))
    : defaultWorkflows;
  const workflowsById = new Map<string, WorkflowDefinition>();
  incomingWorkflows.forEach(workflow => {
    if (!workflow?.id || deletedWorkflowIdSet.has(workflow.id)) return;
    const isSocialCampaignWorkflow = workflow.id === SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
    const campaignPhaseNames: Record<string, string> = {
      content_team_review_loop: 'Recheck Revised Assets',
      submit_to_art_director: 'Submit Campaign for Art Director Approval',
      art_director_review: 'Final Art Director Approval',
    };
    const campaignPhaseKinds: Record<string, WorkflowPhaseDefinition['phaseKind']> = {
      content_team_review: 'content_review',
      content_team_review_loop: 'content_review',
      senior_video_editor_review: 'first_review',
      art_director_review: 'final_review',
      approved: 'final_review',
    };
    workflowsById.set(workflow.id, {
      ...workflow,
      active: workflow.active !== false,
      taskTypeIds: Array.from(new Set([
        ...(Array.isArray(workflow.taskTypeIds)
        ? workflow.taskTypeIds.map(cleanTaskTypeKey).filter(id => Boolean(id) && (!shouldRemovePrototypeTaskTypes || !isPrototypeTaskType(id)))
        : []),
        ...(isSocialCampaignWorkflow ? ['campaign'] : []),
      ])),
      phases: Array.isArray(workflow.phases) ? workflow.phases.map(phase => ({
        ...phase,
        name: isSocialCampaignWorkflow ? (campaignPhaseNames[phase.id] || phase.name) : phase.name,
        phaseKind: campaignPhaseKinds[phase.id] || phase.phaseKind || (
          phase.reviewStyle === 'final_approval' || (phase.roleIds || []).includes('art_director')
            ? 'final_review'
            : phase.reviewStyle === 'full_review'
              ? 'first_review'
              : /content.*review/i.test(phase.name || '')
                ? 'content_review'
                : /review|approval/i.test(phase.name || '')
                  ? 'first_review'
                  : 'work'
        ),
        reviewStyle: phase.reviewStyle || 'quick_look',
        mode: phase.mode || 'parallel',
        userIds: Array.isArray(phase.userIds) ? phase.userIds : [],
        roleIds: Array.isArray(phase.roleIds) ? phase.roleIds : [],
        responsibilityIds: Array.isArray(phase.responsibilityIds) ? phase.responsibilityIds : [],
        instructions: phase.instructions || '',
        deliverables: Array.isArray(phase.deliverables) ? phase.deliverables : [],
        delayDays: typeof phase.delayDays === 'number' ? phase.delayDays : null,
        maxRevisionRounds: typeof phase.maxRevisionRounds === 'number' ? phase.maxRevisionRounds : null,
        skipCondition: phase.skipCondition || '',
        skipRule: ['none', 'manual', 'if_no_task_links', 'if_no_files_in_previous_version'].includes(phase.skipRule as string)
          ? phase.skipRule
          : 'none',
        isReviewDecision: Boolean(phase.isReviewDecision),
        passToPhaseId: phase.passToPhaseId || null,
        failToPhaseId: phase.failToPhaseId || null,
        returnToPhaseId: phase.returnToPhaseId || null,
        requiredApprovals: typeof phase.requiredApprovals === 'number' ? phase.requiredApprovals : null,
        parentPhaseId: phase.parentPhaseId || null,
        parentPhaseIds: Array.isArray(phase.parentPhaseIds) ? phase.parentPhaseIds : [],
        nodeX: typeof phase.nodeX === 'number' ? phase.nodeX : null,
        nodeY: typeof phase.nodeY === 'number' ? phase.nodeY : null,
        nodeWidth: typeof phase.nodeWidth === 'number' ? phase.nodeWidth : null,
        nodeHeight: typeof phase.nodeHeight === 'number' ? phase.nodeHeight : null,
        nodeType: phase.nodeType === 'note' || phase.nodeType === 'section' ? phase.nodeType : 'step',
        disabled: Boolean(phase.disabled),
        nodeNote: phase.nodeNote || '',
        groupId: phase.groupId || null,
        sectionColor: phase.sectionColor || null,
        subPhases: Array.isArray(phase.subPhases) ? phase.subPhases.map(subPhase => ({
          id: subPhase.id || normalizeSettingId(subPhase.title || 'sub_phase'),
          title: subPhase.title || 'Untitled phase',
          note: subPhase.note || '',
          responsibilityIds: Array.isArray(subPhase.responsibilityIds) ? subPhase.responsibilityIds : [],
        })) : [],
      })) : [],
    });
  });
  const workflows = Array.from(workflowsById.values());
  const workflowIds = new Set(workflows.map(workflow => workflow.id));
  const taskTypeWorkflowIds = {
    ...(settings?.taskTypeWorkflowIds || {}),
  };
  Object.entries(taskTypeWorkflowIds).forEach(([key, workflowId]) => {
    if (!workflowId || deletedWorkflowIdSet.has(workflowId) || !workflowIds.has(workflowId) || (shouldRemovePrototypeTaskTypes && isPrototypeTaskType(key))) {
      delete taskTypeWorkflowIds[key];
    }
  });
  if (workflowIds.has(SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID)) {
    taskTypeWorkflowIds.campaign = SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
    taskTypeWorkflowIds['social media campaign'] = SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
    taskTypeWorkflowIds['social media campaigns'] = SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
  }
  const requestedDefaultWorkflowId = settings?.defaultWorkflowId || SOCIAL_MEDIA_CAMPAIGN_WORKFLOW_ID;
  const defaultWorkflowId = workflowIds.has(requestedDefaultWorkflowId)
    ? requestedDefaultWorkflowId
    : workflows[0]?.id || null;

  // Migration & Dynamic Sync: Always ensure Marwa, Sobeeh, Dina, and Fawzy have correct permissions 
  // and are correctly excluded from handledBy lists, regardless of settings stored in database/localStorage.
  workAssignmentCreatorIds = Array.from(new Set([...workAssignmentCreatorIds, MARWA_ID, AHMED_SOBEEH_ID, DINA_ID, FAWZY_ID]));
  neverHandlerIds = Array.from(new Set([...neverHandlerIds, OMAR_ID, FAWZY_ID, MARWA_ID, AHMED_SOBEEH_ID]));
  selfAssignmentBlockedIds = Array.from(new Set([...selfAssignmentBlockedIds, MARWA_ID, DINA_ID, FAWZY_ID, AHMED_SOBEEH_ID]));
  viewAllWorkloadUserIds = Array.from(new Set([...viewAllWorkloadUserIds, MINA_ID, MARWA_ID, DINA_ID, AHMED_SOBEEH_ID, FAWZY_ID]));

  if (firstReviewerUserIds.length === 0) {
    firstReviewerUserIds = [MINA_ID];
  }
  if (finalReviewerUserIds.length === 0) {
    finalReviewerUserIds = [MARWA_ID];
  }

  const seniorReviewerUserIds = Array.isArray((settings as any)?.seniorReviewerUserIds)
    ? (settings as any).seniorReviewerUserIds.filter((id: unknown) => typeof id === 'string' && id)
    : [MINA_ID];
  const dailyReportReceiverUserIds = Array.isArray((settings as any)?.dailyReportReceiverUserIds)
    ? (settings as any).dailyReportReceiverUserIds.filter((id: unknown) => typeof id === 'string' && id)
    : [];
  const dailyReportAutoSendEnabled = typeof (settings as any)?.dailyReportAutoSendEnabled === 'boolean'
    ? (settings as any).dailyReportAutoSendEnabled
    : true;
  const dailyReportAutoSendTime = typeof (settings as any)?.dailyReportAutoSendTime === 'string'
    ? (settings as any).dailyReportAutoSendTime
    : '17:29';

  return {
    ...defaultAppSettings,
    ...settings,
    responsibilities,
    manualUsers,
    priorities,
    businessCalendar: {
      ...defaultAppSettings.businessCalendar,
      ...(settings?.businessCalendar || {}),
    },
    flowLabels: {
      ...defaultAppSettings.flowLabels,
      ...(settings?.flowLabels || {}),
    },
    settingsManagerUserIds: Array.isArray(settings?.settingsManagerUserIds) ? settings.settingsManagerUserIds : defaultAppSettings.settingsManagerUserIds,
    settingsManagerResponsibilityIds: Array.isArray(settings?.settingsManagerResponsibilityIds) ? settings.settingsManagerResponsibilityIds : defaultAppSettings.settingsManagerResponsibilityIds,
    workAssignmentCreatorIds,
    contributorAssignerIds: Array.isArray(settings?.contributorAssignerIds) ? settings.contributorAssignerIds : defaultAppSettings.contributorAssignerIds,
    neverHandlerIds,
    selfAssignmentBlockedIds,
    videoOnlyHandlerIds: Array.isArray(settings?.videoOnlyHandlerIds) ? settings.videoOnlyHandlerIds : defaultAppSettings.videoOnlyHandlerIds,
    alwaysAssignableHandlerIds: Array.isArray(settings?.alwaysAssignableHandlerIds) ? settings.alwaysAssignableHandlerIds : defaultAppSettings.alwaysAssignableHandlerIds,
    firstReviewerUserIds,
    finalReviewerUserIds,
    viewAllWorkloadUserIds,
    customPermissions: Array.isArray(settings?.customPermissions) ? settings.customPermissions : [],
    customWorkingHours: Array.isArray(settings?.customWorkingHours) ? settings.customWorkingHours : [],
    // Standalone string task types were only test data. Keep only workflow-linked
    // objects while the UI derives the available types from workflows themselves.
    taskTypes: Array.isArray(settings?.taskTypes)
      ? settings.taskTypes.filter(item => {
        if (typeof item !== 'object' || item === null) return false;
        const config = item as TaskTypeConfig;
        return Boolean(config.workflowId) &&
          workflowIds.has(config.workflowId!) &&
          (!shouldRemovePrototypeTaskTypes || !isPrototypeTaskType(String(config.id || '')));
      })
      : [],
    workflows,
    deletedWorkflowIds,
    defaultWorkflowId,
    taskTypeWorkflowIds,
    campaignPlatforms: Array.isArray(settings?.campaignPlatforms) ? settings.campaignPlatforms : defaultAppSettings.campaignPlatforms || [],
    hiddenColumns: Array.isArray(settings?.hiddenColumns) ? settings?.hiddenColumns : [],
    seniorReviewerUserIds,
    dailyReportAutoSendEnabled,
    dailyReportAutoSendTime,
    dailyReportReceiverUserIds,
    notificationResetVersion: typeof (settings as any)?.notificationResetVersion === 'number'
      ? (settings as any).notificationResetVersion
      : 0,
    taskTypeCleanupVersion: 2,
    updatedAt: settings?.updatedAt || defaultAppSettings.updatedAt,
  };
}

export function getResponsibilityForLabel(settings: AppSettings, label: string) {
  const normalized = label.trim().toLowerCase();
  return settings.responsibilities.find(item => item.label.trim().toLowerCase() === normalized) || null;
}

export function getResponsibilityLabelForRole(settings: AppSettings, role: Role) {
  return settings.responsibilities.find(item => item.permissionRole === role)?.label || role;
}

export function canManageAppSettings(user: Pick<User, 'id' | 'role' | 'isAdmin' | 'jobTitle'>, settings: AppSettings) {
  if (user.isAdmin || user.role === 'admin') return true;
  if (settings.settingsManagerUserIds.includes(user.id)) return true;
  const responsibility = user.jobTitle ? getResponsibilityForLabel(settings, user.jobTitle) : null;
  return Boolean(responsibility && settings.settingsManagerResponsibilityIds.includes(responsibility.id));
}

export function getPriorityOption(settings: AppSettings, priority?: Priority | null) {
  return settings.priorities.find(item => item.id === priority) || null;
}

export function getPriorityLabelFromSettings(settings: AppSettings, priority: Priority) {
  if (priority === 'not_set') return 'Not Set';
  return getPriorityOption(settings, priority)?.label || priority;
}

export function getPriorityTone(settings: AppSettings, priority: Priority): PriorityTone {
  return getPriorityOption(settings, priority)?.tone || 'slate';
}

export function getPriorityWeightFromSettings(settings: AppSettings, priority: Priority) {
  if (priority === 'not_set') return Number.MAX_SAFE_INTEGER;
  return getPriorityOption(settings, priority)?.sortOrder ?? Number.MAX_SAFE_INTEGER - 1;
}

export function getActivePriorityOptions(settings: AppSettings) {
  return settings.priorities
    .filter(priority => priority.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(priority => ({ value: priority.id, label: priority.label, tone: priority.tone }));
}

export function sanitizeHandledByWithSettings(settings: AppSettings, ids: string[] = [], assignerId?: string) {
  return Array.from(new Set(ids.filter(id => (
    id &&
    !settings.neverHandlerIds.includes(id) &&
    !(assignerId && settings.selfAssignmentBlockedIds.includes(assignerId) && id === assignerId)
  ))));
}

export function isAssignableHandlerWithSettings(settings: AppSettings, id: string, assignerId?: string) {
  return Boolean(id) && sanitizeHandledByWithSettings(settings, [id], assignerId).length > 0;
}

export function canAssignContributorsWithSettings(settings: AppSettings, userId: string) {
  return settings.contributorAssignerIds.includes(userId);
}

export function isAssignableContributorForTaskWithSettings(settings: AppSettings, user: User, taskType: TaskType, creatorId?: string) {
  if (!isAssignableHandlerWithSettings(settings, user.id)) return false;
  if (!settings.alwaysAssignableHandlerIds.includes(user.id) && user.id === creatorId) return false;
  
  const cleanType = cleanTaskTypeKey(taskType);
  const configs = getTaskTypeConfigs(settings);
  const config = configs.find(c => cleanTaskTypeKey(c.id) === cleanType);

  // Check if this task type is content-related
  const isContentTask = ['write content', 'write caption', 'reels voice over script'].includes(cleanType) ||
    cleanType.includes('content') || cleanType.includes('caption') || cleanType.includes('script') || cleanType.includes('voice over') ||
    (config && config.suggestedJobTitles.some(title => {
      const tLower = title.toLowerCase();
      return tLower.includes('content') || tLower.includes('writer') || tLower.includes('script') || tLower.includes('caption') || tLower.includes('voice over');
    }));

  // Mina is always assignable except for content-related tasks
  const isMina = user.id === MINA_ID || user.email?.toLowerCase().includes('minamagdy5555') || user.name.toLowerCase().includes('mina');
  if (isMina) {
    if (isContentTask) return false;
    return true;
  }

  if (user.role !== 'team_member') return false;

  const jobTitleLower = (user.jobTitle || '').toLowerCase();

  const isContentUser = jobTitleLower.includes('content') || jobTitleLower.includes('writer') || jobTitleLower.includes('script') || jobTitleLower.includes('caption');

  if (isContentTask) {
    // If it is content related, only content users are allowed
    return isContentUser;
  }

  // If it's NOT content related, content users are NOT allowed
  if (isContentUser) {
    return false;
  }

  if (config) {
    if (config.suggestedJobTitles.length === 0) return true;
    return config.suggestedJobTitles.some(title => jobTitleLower.includes(title.toLowerCase()));
  }

  // If it's a Video task type
  if (cleanType === 'video') {
    return jobTitleLower.includes('video');
  }

  // For any other task type (Design/Others)
  return jobTitleLower.includes('designer') || /\bart\b/i.test(jobTitleLower);
}

export function getAssignableContributorsForTaskWithSettings(settings: AppSettings, users: User[], taskType: TaskType, creatorId?: string) {
  return users.filter(user => isAssignableContributorForTaskWithSettings(settings, user, taskType, creatorId));
}

export function getWorkingHoursForUser(settings: AppSettings, user: User) {
  const customList = settings.customWorkingHours || [];
  
  // 1. Employee-specific
  const employeeSetting = customList.find(c => c.targetType === 'employee' && c.targetValue === user.id);
  if (employeeSetting) {
    return {
      workdays: employeeSetting.workdays,
      startTime: employeeSetting.startTime,
      endTime: employeeSetting.endTime,
    };
  }

  // 2. Position-specific
  if (user.jobTitle) {
    const positionSetting = customList.find(
      c => c.targetType === 'position' && c.targetValue.toLowerCase() === user.jobTitle?.toLowerCase()
    );
    if (positionSetting) {
      return {
        workdays: positionSetting.workdays,
        startTime: positionSetting.startTime,
        endTime: positionSetting.endTime,
      };
    }
  }

  // 3. Role-specific
  const roleSetting = customList.find(c => c.targetType === 'role' && c.targetValue === user.role);
  if (roleSetting) {
    return {
      workdays: roleSetting.workdays,
      startTime: roleSetting.startTime,
      endTime: roleSetting.endTime,
    };
  }

  // 4. Global fallback
  return {
    workdays: settings.businessCalendar.workdays,
    startTime: settings.businessCalendar.startTime,
    endTime: settings.businessCalendar.endTime,
  };
}

export function isDeadlineInsideBusinessHours(
  settings: AppSettings,
  deadlineValue: string,
  nowValue = new Date(),
  isOvertime = false,
  assigneeIds: string[] = [],
  userList: User[] = []
) {
  const deadline = new Date(deadlineValue);
  if (!deadlineValue || Number.isNaN(deadline.getTime())) {
    return { ok: false, message: 'Select a valid deadline date and time.' };
  }

  if (deadline.getTime() <= nowValue.getTime()) {
    return { ok: false, message: 'Deadline must be in the future.' };
  }

  const maxFutureDate = new Date(nowValue);
  maxFutureDate.setMonth(maxFutureDate.getMonth() + 1);
  if (deadline.getTime() > maxFutureDate.getTime()) {
    return { ok: false, message: 'Deadline cannot be more than a month in the future.' };
  }

  if (isOvertime) {
    return { ok: true, message: '' };
  }

  if (assigneeIds.length > 0 && userList.length > 0) {
    for (const assigneeId of assigneeIds) {
      const user = userList.find(u => u.id === assigneeId);
      if (!user) continue;

      const schedule = getWorkingHoursForUser(settings, user);
      if (!schedule.workdays.includes(deadline.getDay())) {
        return { 
          ok: false, 
          message: `Deadline must be on a configured working day for ${user.name}.` 
        };
      }

      const minutes = deadline.getHours() * 60 + deadline.getMinutes();
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      if (minutes < startMinutes || minutes > endMinutes) {
        return { 
          ok: false, 
          message: `Deadline must be between ${schedule.startTime} and ${schedule.endTime} for ${user.name}.` 
        };
      }
    }
    return { ok: true, message: '' };
  }

  if (!settings.businessCalendar.workdays.includes(deadline.getDay())) {
    return { ok: false, message: 'Deadline must be on a configured working day.' };
  }

  const minutes = deadline.getHours() * 60 + deadline.getMinutes();
  const [startHour, startMinute] = settings.businessCalendar.startTime.split(':').map(Number);
  const [endHour, endMinute] = settings.businessCalendar.endTime.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (minutes < startMinutes || minutes > endMinutes) {
    return { ok: false, message: `Deadline must be between ${settings.businessCalendar.startTime} and ${settings.businessCalendar.endTime}.` };
  }

  return { ok: true, message: '' };
}

export function priorityToneClasses(tone: PriorityTone, solid = false) {
  const classes: Record<PriorityTone, string> = solid ? {
    emerald: 'bg-emerald-600 text-white border-emerald-700',
    slate: 'bg-slate-200 text-slate-700 border-slate-300',
    amber: 'bg-amber-500 text-black border-amber-600',
    rose: 'bg-rose-600 text-white border-rose-700',
    blue: 'bg-blue-600 text-white border-blue-700',
    indigo: 'bg-indigo-600 text-white border-indigo-700',
    purple: 'bg-purple-600 text-white border-purple-700',
  } : {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    rose: 'bg-rose-100 text-rose-700 border-rose-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
  };
  return classes[tone];
}

export function resolveLegacyIds(ids: string[], userList: User[]): string[] {
  if (!userList || userList.length === 0) return ids;
  return ids.map(id => {
    if (id === 'user_1') {
      return userList.find(u => u.email?.toLowerCase().includes('minamagdy5555') || u.name.toLowerCase().includes('mina'))?.id || id;
    }
    if (id === 'user_2') {
      return userList.find(u => u.email?.toLowerCase().includes('marwa.elkady') || u.name.toLowerCase().includes('marwa'))?.id || id;
    }
    if (id === 'user_3') {
      return userList.find(u => u.email?.toLowerCase().includes('dina.') || u.name.toLowerCase().includes('dina'))?.id || id;
    }
    if (id === 'user_4') {
      return userList.find(u => u.email?.toLowerCase().includes('mariamezzat') || u.name.toLowerCase().includes('mariam'))?.id || id;
    }
    if (id === 'user_5') {
      return userList.find(u => u.email?.toLowerCase().includes('noreen') || u.name.toLowerCase().includes('noreen'))?.id || id;
    }
    if (id === 'user_6') {
      return userList.find(u => u.email?.toLowerCase().includes('yf.amin') || u.name.toLowerCase().includes('yomna'))?.id || id;
    }
    if (id === 'user_7') {
      return userList.find(u => u.email?.toLowerCase().includes('fawzy') || u.name.toLowerCase().includes('fawzy'))?.id || id;
    }
    if (id === 'user_8') {
      return userList.find(u => u.email?.toLowerCase().includes('omarmansoour') || u.name.toLowerCase().includes('omar'))?.id || id;
    }
    if (id === 'user_9') {
      return userList.find(u => u.email?.toLowerCase().includes('sobeeh') || u.name.toLowerCase().includes('sobeeh'))?.id || id;
    }
    if (id === 'user_10') {
      return userList.find(u => u.email?.toLowerCase().includes('reem') || u.name.toLowerCase().includes('reem'))?.id || id;
    }
    if (id === 'user_11') {
      return userList.find(u => u.email?.toLowerCase().includes('samamoh') || u.name.toLowerCase().includes('sama'))?.id || id;
    }
    if (id === 'user_12') {
      return userList.find(u => u.email?.toLowerCase().includes('haneen') || u.name.toLowerCase().includes('haneen'))?.id || id;
    }
    return id;
  });
}

export function resolveAppSettingsWithRealIds(settings: AppSettings, userList: User[]): AppSettings {
  if (!userList || userList.length === 0) return settings;

  return {
    ...settings,
    settingsManagerUserIds: resolveLegacyIds(settings.settingsManagerUserIds, userList),
    workAssignmentCreatorIds: resolveLegacyIds(settings.workAssignmentCreatorIds, userList),
    contributorAssignerIds: resolveLegacyIds(settings.contributorAssignerIds, userList),
    neverHandlerIds: resolveLegacyIds(settings.neverHandlerIds, userList),
    selfAssignmentBlockedIds: resolveLegacyIds(settings.selfAssignmentBlockedIds, userList),
    videoOnlyHandlerIds: resolveLegacyIds(settings.videoOnlyHandlerIds, userList),
    alwaysAssignableHandlerIds: resolveLegacyIds(settings.alwaysAssignableHandlerIds, userList),
    firstReviewerUserIds: resolveLegacyIds(settings.firstReviewerUserIds, userList),
    finalReviewerUserIds: resolveLegacyIds(settings.finalReviewerUserIds, userList),
    viewAllWorkloadUserIds: resolveLegacyIds(settings.viewAllWorkloadUserIds, userList),
  };
}
