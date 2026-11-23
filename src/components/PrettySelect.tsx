"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type PrettySelectOption = {
  value: string;
  label: string;
  color?: string | null;
  hint?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: PrettySelectOption[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
};

export function PrettySelect({ value, onChange, options, placeholder, disabled = false, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        className="input flex h-10 items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:bg-slate-100"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate text-sm">
          {selected ? (
            <span className="inline-flex items-center gap-2">
              {selected.color && (
                <span
                  className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                  style={{ backgroundColor: selected.color }}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="text-slate-500">{placeholder}</span>
          )}
        </span>
        <span className={`text-xs text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open && (
        <div className="select-menu absolute z-40 mt-1 w-full">
          <ul className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    className="select-option flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                    data-active={isSelected}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {option.color && (
                      <span
                        className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                        style={{ backgroundColor: option.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.hint && <span className="text-xs text-slate-400">{option.hint}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
