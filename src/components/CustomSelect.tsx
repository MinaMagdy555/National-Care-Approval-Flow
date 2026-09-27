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
      const viewportPadding = 12;
      const menuWidth = Math.min(Math.max(rect.width, 200), window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(rect.right - menuWidth, viewportPadding),
        window.innerWidth - menuWidth - viewportPadding
      );
      const gap = 4;
      const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
      const availableAbove = rect.top - viewportPadding - gap;
      const maximumMenuHeight = Math.max(80, Math.min(320, window.innerHeight - viewportPadding * 2));
      const contentHeight = Math.min(menuRef.current?.scrollHeight || options.length * 44 + 8, maximumMenuHeight);
      const opensAbove = availableBelow < contentHeight && availableAbove > availableBelow;
      const availableHeight = Math.max(80, opensAbove ? availableAbove : availableBelow);
      const renderedHeight = Math.min(contentHeight, availableHeight);
      const top = opensAbove
        ? Math.max(viewportPadding, rect.top - gap - renderedHeight)
        : Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - renderedHeight);

      setMenuStyle({
        position: 'fixed',
        top,
        left,
        width: rect.width,
        minWidth: 200,
        maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
        maxHeight: Math.min(maximumMenuHeight, availableHeight),
        overflowY: 'auto',
      });
    };

    updateMenuPosition();

    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, options.length]);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
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
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "group flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-bold transition-colors outline-none focus:outline-none",
                    option.value === value
                      ? "bg-indigo-600 text-white"
                      : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-950"
                  )}
                >
                  <span className={cn("flex min-w-0 items-center gap-2 truncate", option.value === value ? "text-white" : "text-slate-600 group-hover:text-indigo-950")}>
                    {option.tone && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full border", priorityToneClasses(option.tone))} />}
                    {option.label}
                  </span>
                  {option.value === value && <Check className="h-4 w-4 text-white" />}
                </button>
             ))}
          </div>,
          document.body
        )
      )}
    </div>
  );
}
