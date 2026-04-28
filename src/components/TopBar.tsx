import React from 'react';
import { useAppStore } from '../lib/store';
import { Environment } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';
import { Menu } from 'lucide-react';

export function TopBar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const {
    environment,
    setEnvironment,
    currentUser,
    setCurrentUser,
    persistenceMode,
    persistenceError,
    localMigrationCount,
    isMigratingLocalData,
    migrateLocalDataToSupabase,
    dismissLocalMigration,
  } = useAppStore();

  const isDemo = environment === 'demo';
  const hasSharedData = persistenceMode === 'supabase' && !persistenceError;

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
        <div className={`flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 ${
          hasSharedData
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${hasSharedData ? 'bg-sky-500' : 'bg-amber-500'}`}></span>
          <span className="truncate text-xs font-bold uppercase tracking-wide">
            {hasSharedData ? 'Shared Data' : persistenceMode === 'supabase' ? 'Shared Data Error' : 'Local Data Only'}
          </span>
        </div>
      </div>

      {hasSharedData && localMigrationCount > 0 && (
        <div className="col-span-full flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 md:order-last md:w-full lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm font-bold">
            {localMigrationCount} local-only item{localMigrationCount === 1 ? '' : 's'} found on this browser.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={migrateLocalDataToSupabase}
              disabled={isMigratingLocalData}
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
            >
              {isMigratingLocalData ? 'Uploading...' : 'Move to Shared Data'}
            </button>
            <button
              type="button"
              onClick={dismissLocalMigration}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-amber-800 transition-colors hover:bg-amber-100"
            >
              Not Now
            </button>
          </div>
        </div>
      )}

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
