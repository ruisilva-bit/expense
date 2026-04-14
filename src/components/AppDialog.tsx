"use client";

import { useEffect } from "react";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

type AppDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClassName?: string;
};

export function AppDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  maxWidthClassName = "max-w-lg",
}: AppDialogProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const releaseLock = lockBodyScroll();
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      releaseLock();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`w-full rounded-t-3xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl ${maxWidthClassName}`}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
          <div>
            {subtitle && <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{subtitle}</p>}
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          </div>
          <button type="button" className="btn btn-ghost px-3 py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="max-h-[78vh] space-y-4 overflow-y-auto p-4 sm:p-5">{children}</div>
      </section>
    </div>
  );
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AppDialog open={open} onClose={onClose} title={title} maxWidthClassName="max-w-md">
      <p className="text-sm text-slate-600">{description}</p>
      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
        <button type="button" className="btn btn-ghost border border-slate-200" onClick={onClose}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${destructive ? "bg-red-600 text-white hover:bg-red-700" : "btn-primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </AppDialog>
  );
}
