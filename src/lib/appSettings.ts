import { AppSettings, Priority, PriorityOption, PriorityTone, ResponsibilityOption, Role, TaskType, User, TaskTypeConfig } from './types';

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

export const defaultResponsibilities: ResponsibilityOption[] = [
  { id: 'senior_brand_designer_video_editor', label: 'Senior Brand Designer & Video Editor', permissionRole: 'reviewer' },
  { id: 'art_director', label: 'Final Approvement', permissionRole: 'art_director' },
  { id: 'team_leader', label: 'Team Leader', permissionRole: 'team_leader' },
  { id: 'manager', label: 'Manager', permissionRole: 'manager' },
  { id: 'developer', label: 'Developer', permissionRole: 'developer' },
  { id: 'marketing_manager', label: 'Marketing Manager', permissionRole: 'marketing_manager' },
  { id: 'graphic_designer', label: 'Graphic Designer', permissionRole: 'team_member' },
  { id: 'video_editor', label: 'Video Editor', permissionRole: 'team_member' },
  { id: 'content_creator', label: 'Content Creator', permissionRole: 'team_member' },
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
    assignedWork: 'Assigned Work',
  },
  customPermissions: [],
  taskTypes: [
    'video',
    'ai packet',
    'sales material',
    'website material',
    'campaign',
    'write content',
    'write caption',
    'reels voice over script',
    'others'
  ],
  campaignPlatforms: ['Instagram', 'LinkedIn', 'TikTok', 'Snapchat'],
  hiddenColumns: [],
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
  const types = settings.taskTypes || [];
  return types.map(t => {
    if (typeof t === 'object' && t !== null) {
      return {
        id: (t as any).id,
        label: (t as any).label || getTaskTypeLabelSimple((t as any).id),
        suggestedJobTitles: Array.isArray((t as any).suggestedJobTitles) ? (t as any).suggestedJobTitles : [],
        isDetailedReview: typeof (t as any).isDetailedReview === 'boolean' ? (t as any).isDetailedReview : false,
        fullReviewerUserIds: Array.isArray((t as any).fullReviewerUserIds) ? (t as any).fullReviewerUserIds : [],
        quickLookUserIds: Array.isArray((t as any).quickLookUserIds) ? (t as any).quickLookUserIds : [],
        finalReviewerUserIds: Array.isArray((t as any).finalReviewerUserIds) ? (t as any).finalReviewerUserIds : [],
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
    };
  });
}

export function mergeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const priorities = Array.isArray(settings?.priorities) && settings.priorities.length > 0
    ? settings.priorities
    : defaultAppSettings.priorities;
  const responsibilities = Array.isArray(settings?.responsibilities) && settings.responsibilities.length > 0
    ? settings.responsibilities
    : defaultAppSettings.responsibilities;

  let workAssignmentCreatorIds = Array.isArray(settings?.workAssignmentCreatorIds) ? settings.workAssignmentCreatorIds : defaultAppSettings.workAssignmentCreatorIds;
  let neverHandlerIds = Array.isArray(settings?.neverHandlerIds) ? settings.neverHandlerIds : defaultAppSettings.neverHandlerIds;
  let selfAssignmentBlockedIds = Array.isArray(settings?.selfAssignmentBlockedIds) ? settings.selfAssignmentBlockedIds : defaultAppSettings.selfAssignmentBlockedIds;
  let firstReviewerUserIds = Array.isArray(settings?.firstReviewerUserIds) ? settings.firstReviewerUserIds : defaultAppSettings.firstReviewerUserIds || [];
  let finalReviewerUserIds = Array.isArray(settings?.finalReviewerUserIds) ? settings.finalReviewerUserIds : defaultAppSettings.finalReviewerUserIds || [];
  let viewAllWorkloadUserIds = Array.isArray(settings?.viewAllWorkloadUserIds) ? settings.viewAllWorkloadUserIds : defaultAppSettings.viewAllWorkloadUserIds || [];

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

  return {
    ...defaultAppSettings,
    ...settings,
    responsibilities,
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
    taskTypes: Array.isArray(settings?.taskTypes) ? settings.taskTypes : defaultAppSettings.taskTypes || [],
    campaignPlatforms: Array.isArray(settings?.campaignPlatforms) ? settings.campaignPlatforms : defaultAppSettings.campaignPlatforms || [],
    hiddenColumns: Array.isArray(settings?.hiddenColumns) ? settings.hiddenColumns : [],
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

export function isDeadlineInsideBusinessHours(settings: AppSettings, deadlineValue: string, nowValue = new Date(), isOvertime = false) {
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
