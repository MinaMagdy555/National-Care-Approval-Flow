import { User, Task } from './types';

export const initialUsers: User[] = [
  { id: 'user_1', name: 'Mina M. Bashir', role: 'reviewer', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150', jobTitle: 'Senior Brand Designer & Video Editor' },
  { id: 'user_2', name: 'Marwa ElKady', role: 'art_director', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150', jobTitle: 'Art Director' },
  { id: 'user_3', name: 'Dina ElAlfy', role: 'team_leader', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150', jobTitle: 'Team Leader' },
  { id: 'user_7', email: 'ahmed.mostafa.fawzy@gmail.com', name: 'Eng. Fawzy', role: 'manager', avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=150', jobTitle: 'Manager' },
  { id: 'user_8', email: 'omarmansoour96@gmail.com', name: 'Omar Mansour', role: 'developer', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150', jobTitle: 'Developer' },
  { id: 'user_9', email: 'ahmed.sobeeh@example.com', name: 'Ahmed Sobeeh', role: 'marketing_manager', avatar: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&w=150', jobTitle: 'Marketing Manager' },
  { id: 'user_4', name: 'Mariam', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_5', name: 'Noreen', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_6', name: 'Yomna', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150', jobTitle: 'Video Editor' },
];

export const demoAccounts = [
  { userId: 'user_1', password: 'Password 1' },
  { userId: 'user_3', password: 'Password 2' },
  { userId: 'user_2', password: 'Password 3' },
  { userId: 'user_4', password: 'Password 4' },
  { userId: 'user_5', password: 'Password 5' },
  { userId: 'user_6', password: 'Password 6' },
  { userId: 'user_7', password: 'Password 7' },
  { userId: 'user_8', password: 'Password 8' },
  { userId: 'user_9', password: 'Password 9' },
].map(account => ({
  ...account,
  user: initialUsers.find(user => user.id === account.userId)!,
}));

export const userRoleLabels: Record<string, string> = {
  reviewer: 'Senior Brand Designer & Video Editor',
  art_director: 'Art Director',
  team_member: 'Graphic Designer',
  team_leader: 'Team Leader',
  manager: 'Manager',
  developer: 'Developer',
  marketing_manager: 'Marketing Manager',
  admin: 'Admin',
};

const now = new Date();

function addDays(days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date;
}

function localDateTime(days: number, hour: number, minute = 0) {
  const date = addDays(days);
  date.setHours(hour, minute, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function isoDaysAgo(days: number) {
  return addDays(-days).toISOString();
}

function placeholderTask(overrides: Partial<Task> & Pick<Task, 'id' | 'code' | 'name' | 'taskType' | 'createdBy' | 'status' | 'currentOwnerRole'>): Task {
  const createdAt = overrides.createdAt || isoDaysAgo(4);
  const handledBy = overrides.handledBy || [overrides.createdBy];
  const thumbnailUrl = overrides.thumbnailUrl || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=900&q=80';

  return {
    reviewMode: 'full_review',
    environment: 'production',
    handledBy,
    currentOwnerUserId: overrides.currentOwnerUserIds?.[0] || overrides.currentOwnerUserId || null,
    currentOwnerUserIds: overrides.currentOwnerUserIds || [],
    priority: 'normal',
    deadlineText: null,
    description: null,
    assignmentPeriod: null,
    assignmentLinks: [],
    deadlineAt: null,
    assignmentUploadedAt: null,
    scheduledPublishAt: null,
    publishNote: null,
    publishedAt: null,
    publishReminderSentAt: null,
    versions: [
      {
        id: `${overrides.id}_v1`,
        versionNumber: 1,
        submittedBy: overrides.createdBy,
        submissionNote: 'Placeholder asset for workflow demo',
        fileUrl: `https://example.com/${overrides.id}`,
        files: [
          {
            id: `${overrides.id}_link`,
            name: `${overrides.name}.pdf`,
            type: 'application/pdf',
            size: 0,
            url: `https://example.com/${overrides.id}`,
            storageProvider: 'link',
            previewUrl: thumbnailUrl,
            previewStoragePath: `placeholder:${overrides.id}`,
          },
        ],
        createdAt,
      },
    ],
    comments: [],
    thumbnailUrl,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    ...overrides,
  };
}

// Temporary placeholder tasks for demoing the workflow. Remove this array when real tasks are ready.
export const initialTasks: Task[] = [
  placeholderTask({
    id: 'placeholder_full_review',
    code: 'TMP-2026-0001',
    name: 'Placeholder - Dental Awareness Video',
    taskType: 'video',
    reviewMode: 'full_review',
    createdBy: 'user_6',
    handledBy: ['user_6', 'user_4'],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserIds: ['user_1'],
    priority: 'high',
    deadlineText: 'today',
    thumbnailUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=900&q=80',
  }),
  placeholderTask({
    id: 'placeholder_quick_look',
    code: 'TMP-2026-0002',
    name: 'Placeholder - Instagram Story Set',
    taskType: 'sales_material',
    reviewMode: 'quick_look',
    createdBy: 'user_4',
    handledBy: ['user_4', 'user_5'],
    status: 'waiting_reviewer_quick_look',
    currentOwnerRole: 'reviewer',
    currentOwnerUserIds: ['user_1'],
    priority: 'normal',
    deadlineText: 'tomorrow',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=900&q=80',
  }),
  placeholderTask({
    id: 'placeholder_ad_review',
    code: 'TMP-2026-0003',
    name: 'Placeholder - Brand Campaign Key Visual',
    taskType: 'campaign',
    reviewMode: 'direct_to_ad',
    createdBy: 'user_1',
    handledBy: ['user_1', 'user_4'],
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserIds: ['user_2'],
    priority: 'urgent',
    deadlineText: 'this week',
    scheduledPublishAt: localDateTime(2, 10),
    publishNote: 'Placeholder launch post for campaign scheduler.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=900&q=80',
  }),
  placeholderTask({
    id: 'placeholder_reviewer_returned',
    code: 'TMP-2026-0004',
    name: 'Placeholder - Product Flyer Edits',
    taskType: 'sales_material',
    reviewMode: 'full_review',
    createdBy: 'user_5',
    handledBy: ['user_5'],
    status: 'changes_requested_by_reviewer',
    currentOwnerRole: 'team_member',
    currentOwnerUserIds: ['user_5'],
    priority: 'high',
    deadlineText: 'today',
    thumbnailUrl: 'https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=900&q=80',
    comments: [
      {
        id: 'placeholder_reviewer_returned_comment',
        authorId: 'user_1',
        action: 'request_edits',
        message: 'Placeholder feedback: update the headline and replace the footer CTA.',
        sections: [],
        createdAt: isoDaysAgo(1),
      },
    ],
  }),
  placeholderTask({
    id: 'placeholder_ad_returned',
    code: 'TMP-2026-0005',
    name: 'Placeholder - Website Hero Banner',
    taskType: 'website_material',
    reviewMode: 'full_review',
    createdBy: 'user_4',
    handledBy: ['user_4', 'user_6'],
    status: 'changes_requested_by_art_director',
    currentOwnerRole: 'team_member',
    currentOwnerUserIds: ['user_4', 'user_6'],
    priority: 'normal',
    deadlineText: 'friday',
    thumbnailUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=80',
    comments: [
      {
        id: 'placeholder_ad_returned_comment',
        authorId: 'user_2',
        action: 'marwa_rejection',
        message: 'Placeholder feedback: simplify the visual direction before approval.',
        sections: [],
        createdAt: isoDaysAgo(1),
      },
    ],
  }),
  placeholderTask({
    id: 'placeholder_approved',
    code: 'TMP-2026-0006',
    name: 'Placeholder - Approved Clinic Poster',
    taskType: 'others',
    reviewMode: 'full_review',
    createdBy: 'user_5',
    handledBy: ['user_5'],
    status: 'approved_by_art_director',
    currentOwnerRole: null,
    currentOwnerUserIds: [],
    priority: 'low',
    deadlineText: null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1584515933487-779824d29309?auto=format&fit=crop&w=900&q=80',
  }),
  placeholderTask({
    id: 'placeholder_campaign_overdue',
    code: 'TMP-2026-0007',
    name: 'Placeholder - Overdue Campaign Publish',
    taskType: 'campaign',
    reviewMode: 'direct_to_ad',
    createdBy: 'user_4',
    handledBy: ['user_4'],
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserIds: ['user_2'],
    priority: 'urgent',
    deadlineText: 'yesterday',
    scheduledPublishAt: localDateTime(-1, 12),
    publishNote: 'Placeholder overdue item for scheduler testing.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80',
  }),
  placeholderTask({
    id: 'placeholder_campaign_published',
    code: 'TMP-2026-0008',
    name: 'Placeholder - Published Awareness Campaign',
    taskType: 'campaign',
    reviewMode: 'full_review',
    createdBy: 'user_6',
    handledBy: ['user_6'],
    status: 'approved_by_art_director',
    currentOwnerRole: null,
    currentOwnerUserIds: [],
    priority: 'normal',
    scheduledPublishAt: localDateTime(-2, 9, 30),
    publishedAt: isoDaysAgo(2),
    publishNote: 'Placeholder published campaign.',
    thumbnailUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
  }),
];
