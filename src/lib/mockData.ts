import { User, Task } from './types';

export const initialUsers: User[] = [
  { id: 'user_1', name: 'Mina M. Bashir', role: 'reviewer', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150', jobTitle: 'Senior Brand Designer & Video Editor' },
  { id: 'user_2', name: 'Marwa ElKady', role: 'art_director', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150', jobTitle: 'Art Director' },
  { id: 'user_3', name: 'Dina ElAlfy', role: 'team_leader', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150', jobTitle: 'Team Leader' },
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
].map(account => ({
  ...account,
  user: initialUsers.find(user => user.id === account.userId)!,
}));

export const userRoleLabels: Record<string, string> = {
  reviewer: 'Senior Brand Designer & Video Editor',
  art_director: 'Art Director',
  team_member: 'Graphic Designer',
  team_leader: 'Team Leader',
  admin: 'Admin',
};

const guestTaskImages = {
  launchPoster: 'https://images.unsplash.com/photo-1492724441997-5dc865305da7?auto=format&fit=crop&w=900&q=80',
  serviceVideo: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
  brochure: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=900&q=80',
  socialSet: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=900&q=80',
};

function guestImageFile(id: string, name: string, url: string) {
  return {
    id,
    name,
    type: 'image/jpeg',
    size: 0,
    url,
    previewUrl: url,
    previewStoragePath: `guest-seed/previews/${id}.jpg`,
  };
}

export const initialTasks: Task[] = [];

export const guestTasks: Task[] = [
  {
    id: 'guest_seed_waiting_reviewer',
    code: 'GST-2026-0001',
    name: 'Guest Campaign Poster',
    taskType: 'campaign',
    reviewMode: 'full_review',
    environment: 'production',
    createdBy: 'guest',
    handledBy: ['guest'],
    status: 'waiting_reviewer_full_review',
    currentOwnerRole: 'reviewer',
    currentOwnerUserId: null,
    priority: 'normal',
    deadlineText: 'Today 5 PM',
    versions: [
      {
        id: 'guest_seed_waiting_reviewer_v1',
        versionNumber: 1,
        submittedBy: 'guest',
        submissionNote: 'Initial guest submission',
        fileUrl: guestTaskImages.launchPoster,
        files: [guestImageFile('guest_seed_waiting_reviewer_file', 'campaign-poster.jpg', guestTaskImages.launchPoster)],
        createdAt: '2026-05-06T09:00:00.000Z',
      },
    ],
    thumbnailUrl: guestTaskImages.launchPoster,
    thumbnailStoragePath: 'guest-seed/previews/guest_seed_waiting_reviewer_file.jpg',
    createdAt: '2026-05-06T09:00:00.000Z',
    updatedAt: '2026-05-06T09:00:00.000Z',
  },
  {
    id: 'guest_seed_waiting_ad',
    code: 'GST-2026-0002',
    name: 'Guest Service Video Thumbnail',
    taskType: 'video',
    reviewMode: 'quick_look',
    environment: 'production',
    createdBy: 'guest',
    handledBy: ['guest'],
    status: 'sent_to_art_director',
    currentOwnerRole: 'art_director',
    currentOwnerUserId: null,
    priority: 'high',
    deadlineText: 'Tomorrow',
    versions: [
      {
        id: 'guest_seed_waiting_ad_v1',
        versionNumber: 1,
        submittedBy: 'guest',
        submissionNote: 'Quick look version',
        fileUrl: guestTaskImages.serviceVideo,
        files: [guestImageFile('guest_seed_waiting_ad_file', 'service-video-thumbnail.jpg', guestTaskImages.serviceVideo)],
        createdAt: '2026-05-05T14:30:00.000Z',
      },
    ],
    thumbnailUrl: guestTaskImages.serviceVideo,
    thumbnailStoragePath: 'guest-seed/previews/guest_seed_waiting_ad_file.jpg',
    createdAt: '2026-05-05T14:30:00.000Z',
    updatedAt: '2026-05-05T15:00:00.000Z',
  },
  {
    id: 'guest_seed_returned',
    code: 'GST-2026-0003',
    name: 'Guest Sales Brochure',
    taskType: 'sales_material',
    reviewMode: 'full_review',
    environment: 'production',
    createdBy: 'guest',
    handledBy: ['guest'],
    status: 'changes_requested_by_reviewer',
    currentOwnerRole: 'team_member',
    currentOwnerUserId: 'guest',
    priority: 'urgent',
    deadlineText: 'This week',
    versions: [
      {
        id: 'guest_seed_returned_v1',
        versionNumber: 1,
        submittedBy: 'guest',
        submissionNote: 'Needs copy update',
        fileUrl: guestTaskImages.brochure,
        files: [guestImageFile('guest_seed_returned_file', 'sales-brochure.jpg', guestTaskImages.brochure)],
        createdAt: '2026-05-03T11:10:00.000Z',
      },
    ],
    comments: [
      {
        id: 'guest_seed_returned_comment',
        authorId: 'user_1',
        action: 'request_edits',
        sections: [
          {
            id: 'guest_seed_returned_note',
            note: 'Please tighten the headline and add the National Care logo lockup before resubmitting.',
          },
        ],
        createdAt: '2026-05-04T08:45:00.000Z',
      },
    ],
    thumbnailUrl: guestTaskImages.brochure,
    thumbnailStoragePath: 'guest-seed/previews/guest_seed_returned_file.jpg',
    createdAt: '2026-05-03T11:10:00.000Z',
    updatedAt: '2026-05-04T08:45:00.000Z',
  },
  {
    id: 'guest_seed_approved',
    code: 'GST-2026-0004',
    name: 'Guest Social Media Set',
    taskType: 'website_material',
    reviewMode: 'direct_to_ad',
    environment: 'production',
    createdBy: 'guest',
    handledBy: ['guest'],
    status: 'approved_by_art_director',
    currentOwnerRole: null,
    currentOwnerUserId: null,
    priority: 'low',
    deadlineText: null,
    versions: [
      {
        id: 'guest_seed_approved_v1',
        versionNumber: 1,
        submittedBy: 'guest',
        submissionNote: 'Approved final set',
        fileUrl: guestTaskImages.socialSet,
        files: [guestImageFile('guest_seed_approved_file', 'social-media-set.jpg', guestTaskImages.socialSet)],
        createdAt: '2026-04-30T12:20:00.000Z',
      },
    ],
    thumbnailUrl: guestTaskImages.socialSet,
    thumbnailStoragePath: 'guest-seed/previews/guest_seed_approved_file.jpg',
    createdAt: '2026-04-30T12:20:00.000Z',
    updatedAt: '2026-05-01T16:00:00.000Z',
  },
];
