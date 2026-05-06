import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, LogOut, UserRound } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { demoAccounts, userRoleLabels } from '../lib/mockData';

const INPUT_CLASS = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500';
const PRIMARY_BUTTON_CLASS = 'flex w-full select-none appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-indigo-600 px-4 py-3 font-black text-white shadow-none outline-none ring-0 transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300';
const SECONDARY_BUTTON_CLASS = 'flex select-none items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-100';

export function AuthScreen({ onContinueAsGuest }: { onContinueAsGuest?: () => void } = {}) {
  const {
    authStatus,
    authError,
    currentUser,
    loginWithPassword,
    logout,
  } = useAppStore();
  const [identifier, setIdentifier] = useState(demoAccounts[0]?.user.name || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runLogin = async (nextIdentifier = identifier, nextPassword = password) => {
    setIsSubmitting(true);
    setMessage('');
    try {
      const result = await loginWithPassword(nextIdentifier, nextPassword);
      setMessage(result.message || (result.ok ? '' : 'Could not open that demo account.'));
      if (result.ok && onContinueAsGuest) onContinueAsGuest();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runLogin();
  };

  const handleUseAccount = (account: typeof demoAccounts[number]) => {
    setIdentifier(account.user.name);
    setPassword(account.password);
    void runLogin(account.user.name, account.password);
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-sm font-black">Loading demo accounts</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4 text-slate-900 sm:p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-black">Demo Accounts</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Use one of the fake local accounts to open the approval workspace.
          </p>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <div className="space-y-3 border-b border-slate-100 p-5 sm:p-6 lg:border-b-0 lg:border-r">
            {demoAccounts.map(account => (
              <button
                key={account.user.id}
                type="button"
                onClick={() => handleUseAccount(account)}
                disabled={isSubmitting}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-sm font-black uppercase text-indigo-900">
                  {account.user.avatar ? <img src={account.user.avatar} alt="" className="h-full w-full object-cover" /> : account.user.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-slate-900">{account.user.name}</p>
                  <p className="truncate text-xs font-semibold text-slate-500">{account.user.jobTitle || userRoleLabels[account.user.role]}</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">
                  {account.password}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
            {authStatus === 'approved' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                Currently using {currentUser.name}.
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Account Name</label>
              <input
                type="text"
                value={identifier}
                onChange={event => setIdentifier(event.target.value)}
                className={INPUT_CLASS}
                autoComplete="username"
                list="demo-account-names"
              />
              <datalist id="demo-account-names">
                {demoAccounts.map(account => (
                  <option key={account.user.id} value={account.user.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className={`${INPUT_CLASS} pr-12`}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {(message || authError) && (
              <p className="flex gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <span>{message || authError}</span>
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className={PRIMARY_BUTTON_CLASS}
            >
              <ArrowRight className="h-4 w-4" />
              {isSubmitting ? 'Opening...' : 'Open Demo Account'}
            </button>
            {authStatus === 'approved' && (
              <button
                type="button"
                onClick={() => void logout()}
                disabled={isSubmitting}
                className={`${SECONDARY_BUTTON_CLASS} w-full`}
              >
                <LogOut className="h-4 w-4" />
                Leave Account
              </button>
            )}
            <p className="flex items-start gap-2 text-xs font-semibold text-slate-400">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
              These accounts are local demo users only. No external authentication or account approval is required.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
