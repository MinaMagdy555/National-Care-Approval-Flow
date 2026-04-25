import { User, Task } from './types';

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

export const initialTasks: Task[] = [];
