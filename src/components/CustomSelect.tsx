import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedContainer = containerRef.current?.contains(target);
      const clickedMenu = menuRef.current?.contains(target);

      if (!clickedContainer && !clickedMenu) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updateMenuPosition = () => {
      const button = buttonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const menuWidth = Math.max(rect.width, 200);
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(rect.right - menuWidth, viewportPadding),
        window.innerWidth - menuWidth - viewportPadding
      );

      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left,
        width: rect.width,
        minWidth: 200,
      });
    };

    updateMenuPosition();

    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-sm font-bold rounded-lg px-3 py-1.5 outline-none text-slate-800 transition-colors shadow-sm"
      >
        <span className="truncate">{selectedOption?.label || value}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="z-[9999] bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden py-1 animate-in fade-in slide-in-from-top-2 duration-100"
          >
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
          </div>,
          document.body
        )
      )}
    </div>
  );
}
