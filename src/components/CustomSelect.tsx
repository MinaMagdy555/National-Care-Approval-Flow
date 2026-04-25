import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function CustomSelect({ options, value, onChange, className }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn("relative z-50", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-sm font-bold rounded-lg px-3 py-1.5 outline-none text-slate-800 transition-colors shadow-sm"
      >
        <span className="truncate">{selectedOption?.label || value}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-1 w-full min-w-[200px] right-0 bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2 duration-100">
          {options.map((option) => (
             <button
               key={option.value}
               onClick={() => {
                 onChange(option.value);
                 setIsOpen(false);
               }}
               className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-between group"
             >
               <span className={cn("truncate", option.value === value ? "text-indigo-600 font-bold" : "text-slate-700")}>
                 {option.label}
               </span>
               {option.value === value && <Check className="w-4 h-4 text-indigo-600" />}
             </button>
          ))}
        </div>
      )}
    </div>
  );
}
