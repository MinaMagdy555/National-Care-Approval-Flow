import { User, Task, TaskVersion } from './types';

export const initialUsers: User[] = [
  { id: 'user_1', name: 'Mina M. Bashir', role: 'reviewer', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150', jobTitle: 'Senior Brand Designer & Video Editor' },
  { id: 'user_2', name: 'Marwa ElKady', role: 'art_director', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150', jobTitle: 'Art Director' },
  { id: 'user_3', name: 'Dina ElAlfy', role: 'team_leader', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150', jobTitle: 'Team Leader' },
  { id: 'user_4', name: 'Mariam', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_5', name: 'Noreen', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_6', name: 'Yomna', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150', jobTitle: 'Video Editor' },
];

export const userRoleLabels: Record<string, string> = {
  reviewer: 'Senior Brand Designer & Video Editor',
  art_director: 'Art Director',
  team_member: 'Graphic Designer', 
  team_leader: 'Team Leader',
  admin: 'Admin',
};

const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

const v1Alice: TaskVersion = {
  id: 'v1_t1',
  versionNumber: 1,
  submittedBy: 'user_1',
  fileUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=800',
  createdAt: twoDaysAgo.toISOString(),
};

const v2Alice: TaskVersion = {
  id: 'v2_t1',
  versionNumber: 2,
  submittedBy: 'user_1',
  submissionNote: 'Fixed the shadow on the edge',
  fileUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=800',
  createdAt: yesterday.toISOString(),
};

export const initialTasks: Task[] = [
  {
    id: 't_1',
    code: 'TSK-2026-00421',
    name: 'Vaseline Cocoa Butter Sales Card',
    taskType: 'sales_material',
    reviewMode: 'full_review',
    environment: 'production',
    createdBy: 'user_1',
    handledBy: ['user_1'],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    priority: 'not_set',
    deadlineText: null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=400',
    versions: [v1Alice, v2Alice],
    createdAt: twoDaysAgo.toISOString(),
    updatedAt: yesterday.toISOString(),
  },
  {
    id: 't_2',
    code: 'TSK-2026-00422',
    name: 'Nivea Ramadan Offer Video',
    taskType: 'video',
    reviewMode: 'direct_to_ad',
    environment: 'production',
    createdBy: 'user_2', // Created by Reviewer
    handledBy: ['user_2'],
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserId: 'user_3',
    priority: 'high',
    deadlineText: 'Thursday night',
    thumbnailUrl: 'https://images.unsplash.com/photo-1616512659455-111d3367649f?auto=format&fit=crop&q=80&w=400',
    versions: [
      {
        id: 'v1_t2',
        versionNumber: 1,
        submittedBy: 'user_2',
        fileUrl: 'https://images.unsplash.com/photo-1616512659455-111d3367649f?auto=format&fit=crop&q=80&w=800',
        createdAt: yesterday.toISOString()
      }
    ],
    createdAt: yesterday.toISOString(),
    updatedAt: yesterday.toISOString()
  },
  {
    id: 't_3',
    code: 'TSK-2026-00423',
    name: 'Dove Moisturizer Quick Look',
    taskType: 'sales_material',
    reviewMode: 'quick_look',
    environment: 'production',
    createdBy: 'user_1',
    handledBy: ['user_1'],
    status: 'waiting_reviewer_quick_look',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    priority: 'not_set',
    deadlineText: null,
    thumbnailUrl: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&q=80&w=400',
    versions: [
      {
        id: 'v1_t3',
        versionNumber: 1,
        submittedBy: 'user_1',
        fileUrl: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?auto=format&fit=crop&q=80&w=800',
        createdAt: yesterday.toISOString()
      }
    ],
    createdAt: yesterday.toISOString(),
    updatedAt: yesterday.toISOString()
  },
  {
    id: 't_4',
    code: 'TSK-2026-00424',
    name: 'Brand Guideline Update Demo',
    taskType: 'website_material',
    reviewMode: 'full_review',
    environment: 'demo',
    createdBy: 'user_1',
    handledBy: ['user_1'],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    priority: 'normal',
    deadlineText: 'Next week',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=400',
    versions: [
      {
        id: 'v1_t4',
        versionNumber: 1,
        submittedBy: 'user_1',
        fileUrl: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&q=80&w=800',
        createdAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 't_5',
    code: 'TSK-2026-00425',
    name: 'Garnier Hair Color IG Story',
    taskType: 'video',
    reviewMode: 'full_review',
    environment: 'production',
    createdBy: 'user_1',
    handledBy: ['user_1'],
    status: 'approved_by_art_director',
    currentOwnerRole: 'team_leader',
    currentOwnerUserId: null,
    priority: 'high',
    deadlineText: 'Friday EOD',
    thumbnailUrl: 'https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&q=80&w=400',
    versions: [
      {
        id: 'v1_t5',
        versionNumber: 1,
        submittedBy: 'user_1',
        fileUrl: 'https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&q=80&w=800',
        createdAt: twoDaysAgo.toISOString()
      }
    ],
    createdAt: twoDaysAgo.toISOString(),
    updatedAt: yesterday.toISOString()
  }
];
