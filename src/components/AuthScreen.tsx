import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, LogOut, UserPlus, UserRound } from 'lucide-react';
import { useAppStore } from '../lib/store';

const INPUT_CLASS = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500';
const PRIMARY_BUTTON_CLASS = 'flex w-full select-none appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-indigo-600 px-4 py-3 font-black text-white shadow-none outline-none ring-0 transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300';
const SECONDARY_BUTTON_CLASS = 'flex select-none items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-100';

export function AuthScreen({ onContinueAsGuest }: { onContinueAsGuest?: () => void } = {}) {
  const {
    authStatus,
    authError,
    currentUser,
    loginWithPassword,
    signupWithEmail,
    logout,
  } = useAppStore();
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const initialSignupEmail = params.get('email') || '';
  const [mode, setMode] = useState<'login' | 'signup'>(params.get('signup') === '1' ? 'signup' : 'login');
  const [identifier, setIdentifier] = useState(initialSignupEmail || '');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState(initialSignupEmail);
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const runLogin = async (nextIdentifier = identifier, nextPassword = password) => {
    setIsSubmitting(true);
    setMessage('');
    try {
      const result = await loginWithPassword(nextIdentifier, nextPassword);
      setMessage(result.message || (result.ok ? '' : 'Could not open that account.'));
      if (result.ok && onContinueAsGuest) onContinueAsGuest();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runLogin();
  };

  const runSignup = async () => {
    setMessage('');
    if (signupPassword !== confirmPassword) {
      setMessage('Password confirmation does not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signupWithEmail(signupEmail, signupPassword, signupName);
      setMessage(result.message || (result.ok ? '' : 'Could not create that account.'));
      if (result.ok && onContinueAsGuest) onContinueAsGuest();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignupSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runSignup();
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 text-slate-900">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-sm font-black">Loading accounts</span>
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
          <h1 className="text-2xl font-black">Sign In</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Create an account with your email, then the admin will assign the right role and position.
          </p>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setMessage('');
              }}
              className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wide transition-colors ${mode === 'login' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setMessage('');
              }}
              className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wide transition-colors ${mode === 'signup' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Create Account
            </button>
          </div>

          {authStatus === 'approved' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
              Currently using {currentUser.name}.
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Email or Full Name</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={event => setIdentifier(event.target.value)}
                  className={INPUT_CLASS}
                  autoComplete="username"
                  placeholder="name@example.com or Full Name"
                  required
                />
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
                    placeholder="Enter your password"
                    required
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
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignupSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Full Name</label>
                <input
                  type="text"
                  value={signupName}
                  onChange={event => setSignupName(event.target.value)}
                  className={INPUT_CLASS}
                  autoComplete="name"
                  placeholder="Your full name"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Email Address</label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={event => setSignupEmail(event.target.value)}
                  className={INPUT_CLASS}
                  autoComplete="email"
                  placeholder="name@example.com"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Password</label>
                <div className="relative">
                  <input
                    type={showSignupPassword ? 'text' : 'password'}
                    value={signupPassword}
                    onChange={event => setSignupPassword(event.target.value)}
                    className={`${INPUT_CLASS} pr-12`}
                    autoComplete="new-password"
                    placeholder="Create a password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword(prev => !prev)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                    title={showSignupPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">Confirm Password</label>
                <input
                  type={showSignupPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  className={INPUT_CLASS}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  required
                />
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
                <UserPlus className="h-4 w-4" />
                {isSubmitting ? 'Creating...' : 'Create Account'}
              </button>
            </form>
          )}

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
            New accounts start as content creators. Admins can change responsibilities and positions from Users & Roles.
          </p>
        </div>
      </div>
    </div>
  );
}
