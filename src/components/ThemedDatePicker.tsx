import React, { useState, useEffect, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface ThemedDatePickerProps {
  value: string;
  onChange: (val: string) => void;
  className?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const formatDatePickerInput = (val: string, prevVal: string) => {
  const isDeleting = prevVal.length > val.length;
  if (isDeleting) return val;

  const digits = val.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) {
    if (digits.length > 6) {
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
    }
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return digits;
};

export function ThemedDatePicker({ value, onChange, className }: ThemedDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverLeft, setPopoverLeft] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const initialDate = value && !isNaN(Date.parse(value)) ? new Date(value) : new Date();
  const [navYear, setNavYear] = useState(initialDate.getFullYear());
  const [navMonth, setNavMonth] = useState(initialDate.getMonth());
  const [inputText, setInputText] = useState(value);

  useEffect(() => {
    setInputText(value);
    if (value && !isNaN(Date.parse(value))) {
      const d = new Date(value);
      setNavYear(d.getFullYear());
      setNavMonth(d.getMonth());
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const formatted = formatDatePickerInput(val, inputText);
    setInputText(formatted);
    onChange(formatted);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    // Cap to ensure popover (w-72 = 288px) does not overflow container
    const leftVal = Math.max(0, Math.min(clickX, rect.width - 288));
    setPopoverLeft(leftVal);
  };

  const handlePrevMonth = () => {
    if (navMonth === 0) {
      setNavMonth(11);
      setNavYear(prev => prev - 1);
    } else {
      setNavMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (navMonth === 11) {
      setNavMonth(0);
      setNavYear(prev => prev + 1);
    } else {
      setNavMonth(prev => prev + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const monthStr = String(navMonth + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const selectedDateStr = `${navYear}-${monthStr}-${dayStr}`;
    setInputText(selectedDateStr);
    onChange(selectedDateStr);
    setIsOpen(false);
  };

  const daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
  const firstDayIndex = new Date(navYear, navMonth, 1).getDay();

  const days: Array<{ day: number | null; isCurrent: boolean }> = [];
  
  for (let i = 0; i < firstDayIndex; i++) {
    days.push({ day: null, isCurrent: false });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ day: i, isCurrent: true });
  }

  const selectedDay = (() => {
    if (!value || isNaN(Date.parse(value))) return null;
    const d = new Date(value);
    if (d.getFullYear() === navYear && d.getMonth() === navMonth) {
      return d.getDate();
    }
    return null;
  })();

  const today = new Date();
  const isToday = (day: number) => {
    return today.getDate() === day && today.getMonth() === navMonth && today.getFullYear() === navYear;
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={inputText}
          placeholder="YYYY-MM-DD"
          onChange={handleInputChange}
          onMouseDown={handleMouseDown}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm font-bold text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 cursor-pointer"
        />
      </div>

      {isOpen && (
        <div 
          style={{ left: `${popoverLeft}px` }}
          className="absolute z-50 mt-2 w-72 rounded-2xl border border-slate-150 bg-white p-4 shadow-xl ring-1 ring-slate-900/5 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-black text-slate-800">
              {MONTH_NAMES[navMonth]} {navYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
            {WEEKDAYS.map(d => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((item, idx) => {
              if (item.day === null) {
                return <div key={`empty-${idx}`} />;
              }
              const isSel = selectedDay === item.day;
              const isTd = isToday(item.day);
              return (
                <button
                  key={`day-${item.day}`}
                  type="button"
                  onClick={() => handleSelectDay(item.day!)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold transition-all",
                    isSel 
                      ? "bg-indigo-600 text-white font-black shadow-md shadow-indigo-150" 
                      : isTd
                        ? "bg-slate-100 text-indigo-600 border border-indigo-200 font-black"
                        : "text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {item.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
