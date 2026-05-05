import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, UserPlus } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Role } from '../lib/types';
import { userRoleLabels } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'team_member', label: 'Team Member' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'art_director', label: 'Art Director' },
  { value: 'team_leader', label: 'Team Leader' },
];

const INPUT_CLASS = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500';
const SELECT_CLASS = 'rounded-xl border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 shadow-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';
const PRIMARY_BUTTON_CLASS = 'flex w-full select-none appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-indigo-600 px-4 py-3 font-black text-white shadow-none outline-none ring-0 transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300';
const SECONDARY_BUTTON_CLASS = 'flex w-full select-none items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-100';

export function AuthScreen() {
  const {
    authStatus,
    authProfile,
    authError,
    loginWithPassword,
    registerProfile,
    signInWithGoogle,
    updatePendingProfile,
    logout,
  } = useAppStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [requestedRole, setRequestedRole] = useState<Role>('team_member');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runAction = async (action: () => Promise<{ ok: boolean; message?: string }>) => {
    setIsSubmitting(true);
    setMessage('');
    try {
      const result = await action();
      setMessage(result.message || (result.ok ? '' : 'Something went wrong.'));
      if (result.ok) {
        setPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => mode === 'login'
      ? loginWithPassword(email, password)
      : registerProfile(name, email, password, requestedRole)
    );
  };

  const handleGoogle = () => {
    void runAction(() => signInWithGoogle(name, requestedRole));
  };

  const handleUpdatePending = (event: React.FormEvent) => {
    event.preventDefault();
    void runAction(() => updatePendingProfile(name || authProfile?.name || '', requestedRole));
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-sm font-black">Loading your account</span>
        </div>
      </div>
    );
  }

  if (authStatus === 'configuration_missing') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <AlertCircle className="mb-4 h-8 w-8 text-amber-600" />
          <h1 className="text-xl font-black">Supabase is required</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then run the Supabase SQL setup.
          </p>
        </div>
      </div>
    );
  }

  if (authStatus === 'pending_approval' || authStatus === 'rejected') {
    const isRejected = authStatus === 'rejected';
    const profileName = authProfile?.name || name;
    const profileRole = authProfile?.requestedRole || requestedRole;

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4 text-slate-900 sm:p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          {isRejected ? (
            <AlertCircle className="mb-4 h-8 w-8 text-rose-600" />
          ) : (
            <CheckCircle2 className="mb-4 h-8 w-8 text-indigo-600" />
          )}
          <h1 className="text-xl font-black">{isRejected ? 'Account not approved' : 'Waiting for admin approval'}</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {isRejected
              ? 'Mina/admin rejected this account. Sign out and contact an admin if this was a mistake.'
              : 'Your email is confirmed. Mina/admin needs to approve your account before the workspace opens.'}
          </p>
          {authError && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{authError}</p>}
          {!isRejected && (
            <form onSubmit={handleUpdatePending} className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Name</label>
                <input
                  type="text"
                  value={name || profileName}
                  onChange={event => setName(event.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Requested Role</label>
                <CustomSelect
                  value={profileRole}
                  onChange={value => setRequestedRole(value as Role)}
                  options={ROLE_OPTIONS}
                  buttonClassName={SELECT_CLASS}
                />
              </div>
              {message && <p className="text-sm font-bold text-slate-600">{message}</p>}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full select-none rounded-xl border border-slate-200 px-4 py-3 font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Update Request
              </button>
            </form>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 w-full select-none rounded-xl bg-slate-900 px-4 py-3 font-black text-white transition-colors hover:bg-slate-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-4 text-slate-900 sm:p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-black">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {mode === 'login' ? 'Use your approved account.' : 'Confirm your email, then wait for Mina/admin approval.'}
          </p>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4 p-5 sm:p-6">
          {authStatus === 'pending_confirmation' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              Check your email to confirm your account, then sign in.
            </div>
          )}
          {mode === 'register' && (
            <>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Name</label>
                <input type="text" value={name} onChange={event => setName(event.target.value)} className={INPUT_CLASS} />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Requested Role</label>
                <CustomSelect
                  value={requestedRole}
                  onChange={value => setRequestedRole(value as Role)}
                  options={ROLE_OPTIONS}
                  buttonClassName={SELECT_CLASS}
                />
              </div>
            </>
          )}
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Email</label>
            <input type="email" value={email} onChange={event => setEmail(event.target.value)} className={INPUT_CLASS} autoComplete="email" />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                className={`${INPUT_CLASS} pr-12`}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
            <p className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-600">{message || authError}</p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={PRIMARY_BUTTON_CLASS}
          >
            {mode === 'login' ? <ArrowRight className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {isSubmitting ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Register'}
          </button>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={isSubmitting}
            className={SECONDARY_BUTTON_CLASS}
            title="Continue with Google"
          >
            <Mail className="h-4 w-4" />
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => {
              setMessage('');
              setPassword('');
              setMode(mode === 'login' ? 'register' : 'login');
            }}
            className="w-full select-none rounded-xl px-4 py-2 text-sm font-black text-indigo-700 transition-colors hover:bg-indigo-50"
          >
            {mode === 'login' ? 'Create a new account' : 'Already have an account? Sign in'}
          </button>
          <p className="text-center text-xs font-semibold text-slate-400">
            Requested role examples: {ROLE_OPTIONS.map(option => userRoleLabels[option.value] || option.label).join(', ')}
          </p>
        </form>
      </div>
    </div>
  );
}
