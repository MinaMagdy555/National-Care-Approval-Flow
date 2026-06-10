import React from 'react';
import { useAppStore } from '../lib/store';
import { Bell, Check, FileText, X } from 'lucide-react';
import { cn } from '../lib/utils';

export function NotificationsList({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { notifications, tasks, currentUser, markNotificationAsRead } = useAppStore();

  const userNotifications = notifications.filter(n => n.userId === currentUser.id);

  if (userNotifications.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <h2 className="mb-8 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Notifications</h2>
        <div className="bg-white p-12 rounded-2xl border border-slate-200 shadow-sm text-center">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">No Notifications</h3>
          <p className="text-slate-500">You're all caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <h2 className="mb-8 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Notifications</h2>

      <div className="space-y-4">
        {userNotifications.map(notification => {
          const isDeleted = !tasks.some(t => t.id === notification.taskId);
          return (
            <div 
              key={notification.id}
              className={cn(
                "group flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors sm:gap-4 sm:p-6",
                notification.read 
                  ? "bg-white border-slate-200" 
                  : "bg-indigo-50 border-indigo-200",
                isDeleted && "opacity-80 border-slate-100 bg-slate-50"
              )}
              onClick={() => {
                if (!notification.read) {
                  markNotificationAsRead(notification.id);
                }
                if (!isDeleted) {
                  onOpenTask(notification.taskId);
                }
              }}
            >
              <div className="flex-shrink-0">
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full",
                  isDeleted 
                    ? "bg-rose-50 text-rose-500 border border-rose-200"
                    : notification.read 
                      ? "bg-slate-100 text-slate-500" 
                      : "bg-indigo-100 text-indigo-600"
                )}>
                  {isDeleted ? (
                    <X className="w-5 h-5" />
                  ) : notification.message.includes('rejected') || notification.message.includes('returned') ? (
                    <X className="w-5 h-5" />
                  ) : notification.message.includes('approved') ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <FileText className="w-5 h-5" />
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                 <p className={cn(
                   "text-sm mb-2",
                   notification.read ? "text-slate-600 font-medium" : "text-slate-900 font-bold",
                   isDeleted && "line-through text-slate-400 font-medium"
                 )}>
                   {notification.message}
                   {isDeleted && (
                     <span 
                       className="text-[10px] font-black uppercase text-rose-500 ml-2 no-underline inline-block bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200/50"
                       style={{ textDecoration: 'none' }}
                     >
                       Deleted
                     </span>
                   )}
                 </p>
                 <span className="text-xs font-bold text-slate-400">
                   {new Date(notification.createdAt).toLocaleString()}
                 </span>
              </div>
              {!notification.read && (
                <div className="flex-shrink-0 flex items-center justify-center">
                   <div className="w-2.5 h-2.5 rounded-full bg-indigo-600"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
