"use client";

type LockState = {
  count: number;
  previousOverflow: string;
};

declare global {
  interface Window {
    __homefundBodyScrollLock?: LockState;
  }
}

const getLockState = (): LockState | null => {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!window.__homefundBodyScrollLock) {
    window.__homefundBodyScrollLock = {
      count: 0,
      previousOverflow: document.body.style.overflow || "",
    };
  }
  return window.__homefundBodyScrollLock;
};

export const lockBodyScroll = () => {
  if (typeof document === "undefined") return () => {};
  const state = getLockState();
  if (!state) return () => {};

  if (state.count === 0) {
    state.previousOverflow = document.body.style.overflow || "";
    document.body.style.overflow = "hidden";
  }
  state.count += 1;

  let released = false;

  return () => {
    if (released) return;
    released = true;

    const currentState = getLockState();
    if (!currentState) return;

    currentState.count = Math.max(0, currentState.count - 1);
    if (currentState.count === 0) {
      document.body.style.overflow = currentState.previousOverflow;
    }
  };
};
