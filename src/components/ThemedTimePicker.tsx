import React, { useState, useEffect, useRef } from 'react';
import { Clock3 } from 'lucide-react';
import { cn } from '../lib/utils';

interface ThemedTimePickerProps {
  value: string; // "HH:MM" (24h)
  onChange: (val: string) => void;
  className?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const AMPM = ['AM', 'PM'];

function to12h(time24: string): string {
  if (!time24) return '';
  const match = time24.match(/^(\d{2}):(\d{2})$/);
  if (!match) return time24;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  return `${hoursStr}:${minutes} ${ampm}`;
}

function to24h(time12: string): string {
  if (!time12) return '';
  const match = time12.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) {
    const match24 = time12.trim().match(/^(\d{2}):(\d{2})$/);
    if (match24) {
      const h = parseInt(match24[1], 10);
      const m = parseInt(match24[2], 10);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) {
        return time12.trim();
      }
    }
    return '';
  }
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = match[3];
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

const formatTimePickerInput = (val: string, prevVal: string) => {
  const isDeleting = prevVal.length > val.length;
  if (isDeleting) return val;

  const clean = val.replace(/[^0-9a-zA-Z]/g, '').slice(0, 6);
  const digits = clean.replace(/[^0-9]/g, '').slice(0, 4);
  let letters = clean.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);

  if (letters.startsWith('A')) letters = 'AM';
  if (letters.startsWith('P')) letters = 'PM';

  let formatted = '';
  if (digits.length > 2) {
    formatted = `${digits.slice(0, 2)}:${digits.slice(2)}`;
  } else {
    formatted = digits;
  }

  if (digits.length === 4) {
    const hoursNum = parseInt(digits.slice(0, 2), 10);
    if (hoursNum <= 12) {
      if (letters) {
        formatted = `${formatted} ${letters}`;
      } else {
        formatted = `${formatted} `;
      }
    }
  }

  return formatted;
};

export function ThemedTimePicker({ value, onChange, className }: ThemedTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverLeft, setPopoverLeft] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const initial12h = to12h(value);
  const [inputText, setInputText] = useState(initial12h || value);

  const currentMatch = (initial12h || '').match(/^(\d{2}):(\d{2})\s*(AM|PM)$/);
  const selHour = currentMatch ? currentMatch[1] : '12';
  const selMinute = currentMatch ? currentMatch[2] : '00';
  const selAmpm = currentMatch ? currentMatch[3] : 'AM';

  useEffect(() => {
    const displayVal = to12h(value);
    setInputText(displayVal || value);
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
    const formatted = formatTimePickerInput(val, inputText);
    setInputText(formatted);
    const converted = to24h(formatted);
    if (converted) {
      onChange(converted);
    } else {
      onChange(formatted);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    // Cap to ensure popover (w-56 = 224px) does not overflow container
    const leftVal = Math.max(0, Math.min(clickX, rect.width - 224));
    setPopoverLeft(leftVal);
  };

  const handleSelectPart = (hour: string, minute: string, ampm: string) => {
    const time12Str = `${hour}:${minute} ${ampm}`;
    const time24Str = to24h(time12Str);
    setInputText(time12Str);
    onChange(time24Str);
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={inputText}
          placeholder="hh:mm AM/PM"
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
          className="absolute z-50 mt-2 w-56 rounded-2xl border border-slate-150 bg-white p-3 shadow-xl ring-1 ring-slate-900/5 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 pb-2 mb-2">
            <div>Hour</div>
            <div>Min</div>
            <div>Period</div>
          </div>
          
          <div className="grid grid-cols-3 gap-1">
            <div className="h-40 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              {HOURS.map(h => {
                const active = h === selHour;
                return (
                  <button
                    key={`hour-${h}`}
                    type="button"
                    onClick={() => handleSelectPart(h, selMinute, selAmpm)}
                    className={cn(
                      "block w-full rounded-lg py-1 text-xs font-bold transition-all text-center outline-none focus:outline-none",
                      active 
                        ? "bg-indigo-600 text-white font-black animate-none" 
                        : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-950"
                    )}
                  >
                    {h}
                  </button>
                );
              })}
            </div>

            <div className="h-40 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              {MINUTES.map(m => {
                const active = m === selMinute;
                return (
                  <button
                    key={`min-${m}`}
                    type="button"
                    onClick={() => handleSelectPart(selHour, m, selAmpm)}
                    className={cn(
                      "block w-full rounded-lg py-1 text-xs font-bold transition-all text-center outline-none focus:outline-none",
                      active 
                        ? "bg-indigo-600 text-white font-black animate-none" 
                        : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-950"
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

            <div className="h-40 overflow-y-auto pr-1">
              {AMPM.map(ap => {
                const active = ap === selAmpm;
                return (
                  <button
                    key={`ampm-${ap}`}
                    type="button"
                    onClick={() => handleSelectPart(selHour, selMinute, ap)}
                    className={cn(
                      "block w-full rounded-lg py-1 text-xs font-bold transition-all text-center mb-1 outline-none focus:outline-none",
                      active 
                        ? "bg-indigo-600 text-white font-black animate-none" 
                        : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-950"
                    )}
                  >
                    {ap}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
