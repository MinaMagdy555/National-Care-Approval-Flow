import React from 'react';
import { Check } from 'lucide-react';
import { User } from '../lib/types';
import { cn } from '../lib/utils';
import { userRoleLabels } from '../lib/mockData';

export function UserMultiSelect({
  users,
  selectedIds,
  onChange,
  emptyText = 'No users available',
  disabledIds = [],
  layout = 'grid',
}: {
  users: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyText?: string;
  disabledIds?: string[];
  layout?: 'grid' | 'single';
}) {
  const selected = new Set(selectedIds);
  const disabled = new Set(disabledIds);

  const toggleUser = (userId: string) => {
    if (disabled.has(userId)) return;
    onChange(selected.has(userId)
      ? selectedIds.filter(id => id !== userId)
      : [...selectedIds, userId]
    );
  };

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-400">
        {emptyText}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2", layout === 'grid' && "sm:grid-cols-2")}>
      {users.map(user => {
        const checked = selected.has(user.id);
        const isDisabled = disabled.has(user.id);

        return (
          <button
            key={user.id}
            type="button"
            onClick={() => toggleUser(user.id)}
            disabled={isDisabled}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
              checked ? "border-indigo-200 bg-indigo-50 text-indigo-950" : "border-slate-200 bg-white text-slate-800 hover:border-indigo-200 hover:bg-indigo-50/50",
              isDisabled && "cursor-not-allowed opacity-60"
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-black uppercase text-slate-700">
              {user.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : user.name.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black leading-tight">{user.name}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">{user.jobTitle || userRoleLabels[user.role]}</span>
            </span>
            <span className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
              checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-transparent"
            )}>
              <Check className="h-3.5 w-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
