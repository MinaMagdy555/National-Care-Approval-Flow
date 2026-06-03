import { User, Task } from './types';

export const initialUsers: User[] = [
  { id: 'user_1', name: 'Mina M. Bashir', role: 'reviewer', isAdmin: true, avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150', jobTitle: 'Senior Brand Designer & Video Editor' },
  { id: 'user_2', name: 'Marwa ElKady', role: 'art_director', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150', jobTitle: 'Art Director' },
  { id: 'user_3', name: 'Dina ElAlfy', role: 'team_leader', avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150', jobTitle: 'Team Leader' },
  { id: 'user_7', email: 'ahmed.mostafa.fawzy@gmail.com', name: 'Eng. Fawzy', role: 'manager', avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=150', jobTitle: 'Manager' },
  { id: 'user_8', email: 'omarmansoour96@gmail.com', name: 'Omar Mansour', role: 'developer', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150', jobTitle: 'Developer' },
  { id: 'user_9', email: 'ahmed.sobeeh@example.com', name: 'Ahmed Sobeeh', role: 'marketing_manager', avatar: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?auto=format&fit=crop&w=150', jobTitle: 'Marketing Manager' },
  { id: 'user_4', name: 'Mariam', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_5', name: 'Noreen', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150', jobTitle: 'Graphic Designer' },
  { id: 'user_6', name: 'Yomna', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150', jobTitle: 'Video Editor' },
  { id: 'user_10', name: 'Sama', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1491349174775-aaafddd81942?auto=format&fit=crop&w=150', jobTitle: 'Content Creator' },
  { id: 'user_11', name: 'Haneen', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1546961329-78bef0414d7c?auto=format&fit=crop&w=150', jobTitle: 'Content Creator' },
  { id: 'user_12', name: 'Reem', role: 'team_member', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=150', jobTitle: 'Content Creator' },
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
  { userId: 'user_10', password: 'Password 10' },
  { userId: 'user_11', password: 'Password 11' },
  { userId: 'user_12', password: 'Password 12' },
].map(account => ({
  ...account,
  user: initialUsers.find(user => user.id === account.userId)!,
}));

export const userRoleLabels: Record<string, string> = {
  reviewer: 'Senior Brand Designer & Video Editor',
  art_director: 'Art Director',
  team_member: 'Content Creator',
  team_leader: 'Team Leader',
  manager: 'Manager',
  developer: 'Developer',
  marketing_manager: 'Marketing Manager',
  admin: 'Admin',
};

export const initialTasks: Task[] = [];
