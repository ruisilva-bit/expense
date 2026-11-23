"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="dialog-scrim fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`dialog-panel w-full ${maxWidthClassName}`}
      >
        <header className="dialog-header flex items-start justify-between border-b px-4 py-3 sm:px-5">
          <div>
            {subtitle && <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{subtitle}</p>}
            <h3 className="text-xl">{title}</h3>
          </div>
          <button type="button" className="btn btn-ghost px-3 py-1.5 text-sm" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="dialog-body max-h-[78vh] space-y-4 overflow-y-auto p-4 sm:p-5">{children}</div>
      </section>
    </div>,
    document.body
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
          className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </AppDialog>
  );
}
