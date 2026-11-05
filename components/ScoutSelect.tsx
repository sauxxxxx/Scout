'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';

export type ScoutSelectOption = { value: string; label: string; description?: string };

type Props = {
  value: string;
  options: ScoutSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
};

export function ScoutSelect({ value, options, onChange, ariaLabel, className = '', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex(option => option.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionsRef = useRef(options);
  const listId = useId();
  const selected = options.find(option => option.value === value) || options[0];

  useEffect(() => { optionsRef.current = options; }, [options]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, optionsRef.current.findIndex(option => option.value === value));
    setActiveIndex(selectedIndex);
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, value]);

  const move = (offset: number) => {
    const next = (activeIndex + offset + options.length) % options.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  return <div className={`scout-select ${open ? 'open' : ''} ${className}`.trim()} ref={root}>
    <button
      type="button"
      className="scout-select-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      disabled={disabled}
      onClick={() => setOpen(current => !current)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) setOpen(true);
          else move(event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      <span>{selected?.label || value}</span><FiChevronDown />
    </button>
    {open && <div className="scout-select-menu" id={listId} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={option.value === value ? 'selected' : ''}
        key={option.value}
        ref={node => { optionRefs.current[index] = node; }}
        onMouseEnter={() => setActiveIndex(index)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          if (event.key === 'Tab') setOpen(false);
        }}
        onClick={() => { onChange(option.value); setOpen(false); }}
      >
        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        {option.value === value && <FiCheck />}
      </button>)}
    </div>}
  </div>;
}
