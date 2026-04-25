import React from 'react';
import { useAppStore } from '../lib/store';
import { initialUsers } from '../lib/mockData';
import { Bell, Check, CircleAlert, FileText, X } from 'lucide-react';
import { cn } from '../lib/utils';

export function NotificationsList({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { notifications, currentUser, markNotificationAsRead } = useAppStore();

  const userNotifications = notifications.filter(n => n.userId === currentUser.id);

  if (userNotifications.length === 0) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-8">Notifications</h2>
        <div className="bg-white p-12 rounded-2xl border border-slate-200 shadow-sm text-center">
          <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">No Notifications</h3>
          <p className="text-slate-500">You're all caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-8">Notifications</h2>

      <div className="space-y-4">
        {userNotifications.map(notification => (
          <div 
            key={notification.id}
            className={cn(
              "flex gap-4 p-6 rounded-2xl border transition-colors cursor-pointer group",
              notification.read 
                ? "bg-white border-slate-200" 
                : "bg-indigo-50 border-indigo-200"
            )}
            onClick={() => {
              if (!notification.read) {
                markNotificationAsRead(notification.id);
              }
              onOpenTask(notification.taskId);
            }}
          >
            <div className="flex-shrink-0">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                notification.read ? "bg-slate-100 text-slate-500" : "bg-indigo-100 text-indigo-600"
              )}>
                {notification.message.includes('rejected') || notification.message.includes('returned') ? (
                  <X className="w-5 h-5" />
                ) : notification.message.includes('approved') ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <FileText className="w-5 h-5" />
                )}
              </div>
            </div>
            <div className="flex-1">
               <p className={cn(
                 "text-sm mb-2",
                 notification.read ? "text-slate-600 font-medium" : "text-slate-900 font-bold"
               )}>
                 {notification.message}
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
        ))}
      </div>
    </div>
  );
}
