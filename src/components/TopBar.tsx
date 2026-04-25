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
    <header className="sticky top-0 z-20 grid gap-4 border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 md:flex md:min-h-16 md:items-center md:justify-between md:gap-3 md:shadow-none lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex shrink-0 rounded-lg border border-slate-200 p-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        {isDemo ? (
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-purple-700">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-purple-500"></span>
            <span className="truncate text-xs font-bold uppercase tracking-wide">Demo Mode</span>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
            <span className="truncate text-xs font-bold uppercase tracking-wide">Production Mode</span>
          </div>
        )}
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:w-auto md:flex md:flex-wrap md:items-center md:justify-end md:gap-4 lg:gap-6">
        <div className="grid min-w-0 grid-cols-[112px,minmax(0,1fr)] items-center gap-2 sm:grid-cols-1 sm:gap-1 md:flex md:justify-start md:gap-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Environment:</label>
          <CustomSelect
            className="min-w-0 sm:w-full md:w-[210px]"
            value={environment}
            onChange={(v) => setEnvironment(v as Environment)}
            options={envOptions}
          />
        </div>

        <div className="grid min-w-0 grid-cols-[112px,minmax(0,1fr)] items-center gap-2 sm:grid-cols-1 sm:gap-1 md:flex md:justify-start md:gap-2 md:border-l md:border-slate-200 md:pl-4 lg:pl-6">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">View As:</label>
          <CustomSelect
            className="min-w-0 sm:w-full md:w-[230px]"
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
