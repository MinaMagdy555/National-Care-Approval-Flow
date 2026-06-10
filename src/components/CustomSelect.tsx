import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { PriorityTone } from '../lib/types';
import { priorityToneClasses } from '../lib/appSettings';

interface Option {
  value: string;
  label: string;
  tone?: PriorityTone;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
}

export function CustomSelect({ options, value, onChange, placeholder, className, buttonClassName, menuClassName, disabled }: CustomSelectProps) {
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
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-sm font-bold rounded-lg px-3 py-1.5 outline-none text-slate-800 transition-colors shadow-sm",
          disabled && "bg-slate-50 text-slate-500 hover:bg-slate-50 cursor-not-allowed border-slate-200",
          buttonClassName
        )}
      >
        <span className={cn("flex min-w-0 items-center gap-2 truncate", !selectedOption && placeholder && "text-slate-400")}>
          {selectedOption?.tone && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border", priorityToneClasses(selectedOption.tone))} />}
          {selectedOption?.label || placeholder || value}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className={cn(
              "z-[9999] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl ring-1 ring-slate-900/5 animate-in fade-in slide-in-from-top-2 duration-100",
              menuClassName
            )}
          >
            {options.map((option) => (
               <button
                 key={option.value}
                 onClick={() => {
                   onChange(option.value);
                   setIsOpen(false);
                 }}
                 className="group flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-bold transition-colors hover:bg-slate-100"
               >
                 <span className={cn("flex min-w-0 items-center gap-2 truncate", option.value === value ? "text-slate-950" : "text-slate-600")}>
                   {option.tone && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border", priorityToneClasses(option.tone))} />}
                   {option.label}
                 </span>
                 {option.value === value && <Check className="h-4 w-4 text-slate-900" />}
               </button>
            ))}
          </div>,
          document.body
        )
      )}
    </div>
  );
}
