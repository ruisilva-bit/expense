"use client";

import { useEffect } from "react";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

type Props = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
};

export function EntityPopover({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const releaseLock = lockBodyScroll();
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      releaseLock();
    };
  }, [onClose]);

  return (
    <div
      className="entity-scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <section className="entity-panel w-full max-w-3xl">
        <header className="entity-header sticky top-0 z-10 flex items-start justify-between border-b px-4 py-3 sm:px-5">
          <div>
            {subtitle && <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{subtitle}</p>}
            <h2 className="text-2xl">{title}</h2>
          </div>
          <button className="btn btn-ghost px-3 py-1.5 text-sm" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="entity-body max-h-[86vh] space-y-4 overflow-y-auto p-4 pb-6 sm:max-h-[82vh] sm:p-5">{children}</div>
      </section>
    </div>
  );
}
