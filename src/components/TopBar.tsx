import React from 'react';
import { useAppStore } from '../lib/store';
import { Environment } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';

export function TopBar() {
  const { environment, setEnvironment, currentUser, setCurrentUser } = useAppStore();

  const isDemo = environment === 'demo';

  const envOptions = [
    { value: 'production', label: 'Production' },
    { value: 'demo', label: 'Demo / Training' },
    { value: 'archived', label: 'Archived Test Data' }
  ];

  const userOptions = initialUsers.map(u => ({ value: u.id, label: u.name }));

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-10 sticky top-0">
      <div className="flex items-center gap-4">
        {isDemo ? (
          <div className="flex items-center bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full border border-purple-200 gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
            <span className="text-xs font-bold uppercase tracking-wide">Demo Mode</span>
          </div>
        ) : (
          <div className="flex items-center bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full border border-emerald-200 gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-xs font-bold uppercase tracking-wide">Production Mode</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Environment:</label>
          <CustomSelect 
            value={environment}
            onChange={(v) => setEnvironment(v as Environment)}
            options={envOptions}
          />
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-6">
          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">View As:</label>
          <CustomSelect 
            value={currentUser.id}
            onChange={(v) => {
              const user = initialUsers.find(u => u.id === v);
              if (user) setCurrentUser(user);
            }}
            options={userOptions}
          />
        </div>
      </div>
    </header>
  );
}
