import React from 'react';
import { useAppStore } from '../lib/store';
import { Environment } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';
import { Menu } from 'lucide-react';

export function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { environment, setEnvironment, currentUser, setCurrentUser } = useAppStore();

  const isDemo = environment === 'demo';

  const envOptions = [
    { value: 'production', label: 'Production' },
    { value: 'demo', label: 'Demo / Training' },
    { value: 'archived', label: 'Archived Test Data' }
  ];

  const userOptions = initialUsers.map(u => ({ value: u.id, label: u.name }));

  return (
    <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex rounded-lg border border-slate-200 p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
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

      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-4 lg:gap-6">
        <div className="flex items-center justify-between gap-2 sm:justify-start">
          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Environment:</label>
          <CustomSelect
            className="w-[190px] max-w-[65vw] sm:w-[210px]"
            value={environment}
            onChange={(v) => setEnvironment(v as Environment)}
            options={envOptions}
          />
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-start sm:border-l sm:border-slate-200 sm:pl-4 lg:pl-6">
          <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">View As:</label>
          <CustomSelect
            className="w-[190px] max-w-[65vw] sm:w-[230px]"
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
