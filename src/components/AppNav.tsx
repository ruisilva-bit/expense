"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemePicker } from "@/components/ThemePicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAppState } from "@/context/AppState";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

type NavLink = {
  href: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
};

const iconClassName = "h-[18px] w-[18px] flex-none";

const links: NavLink[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13V10.5" />
      </svg>
    ),
  },
  {
    href: "/transactions",
    label: "Activity",
    shortLabel: "Activity",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M4 7h9" />
        <path d="M4 12h16" />
        <path d="M4 17h11" />
      </svg>
    ),
  },
  {
    href: "/goals",
    label: "Savings",
    shortLabel: "Savings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M12 3v18" />
        <path d="M7 8c0-1.66 2.24-3 5-3s5 1.34 5 3-2.24 3-5 3-5 1.34-5 3 2.24 3 5 3 5-1.34 5-3" />
      </svg>
    ),
  },
  {
    href: "/loans",
    label: "Loans",
    shortLabel: "Loans",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M4 7.5h16" />
        <path d="M4 12h10" />
        <path d="M4 16.5h8" />
        <path d="M18 10v7" />
        <path d="M14.5 13.5H21.5" />
      </svg>
    ),
  },
  {
    href: "/recurring",
    label: "Recurring",
    shortLabel: "Recurring",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M20 8a8 8 0 1 0 1.2 6" />
        <path d="M20 4v4h-4" />
      </svg>
    ),
  },
  {
    href: "/categories",
    label: "Categories",
    shortLabel: "Tags",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <path d="M4 7.5V4h3.5L20 16.5 16.5 20 4 7.5Z" />
        <circle cx="8.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/accounts",
    label: "Accounts",
    shortLabel: "Accounts",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
        <path d="M15 12h5.5" />
      </svg>
    ),
  },
  {
    href: "/families",
    label: "Family",
    shortLabel: "Family",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={iconClassName}>
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16.5" cy="8.5" r="2" />
        <path d="M4.5 18c.7-2.1 2.56-3.5 4.8-3.5h1.4c2.24 0 4.1 1.4 4.8 3.5" />
        <path d="M14.5 17.5c.34-1.32 1.46-2.26 2.9-2.26h.2c1.4 0 2.55.9 2.9 2.26" />
      </svg>
    ),
  },
];

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none" className="h-6 w-6">
        <path d="M11 9v22M29 9v22M11 20h18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="29" cy="9" r="2.25" fill="currentColor" />
      </svg>
    </span>
  );
}

function NavLinkItem({ link, active, onClick }: { link: NavLink; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={link.href}
      onClick={onClick}
      className={`app-nav-link group ${active ? "app-nav-link-active" : ""}`}
    >
      <span className="app-nav-icon">
        {link.icon}
      </span>
      <span className="truncate">{link.label}</span>
    </Link>
  );
}

export function AppNav() {
  const { user, selectedFamily, isAuthLoading } = useAppState();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };

    mediaQuery.addEventListener("change", closeOnDesktop);
    return () => mediaQuery.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    return lockBodyScroll();
  }, [mobileOpen]);

  const familyName = selectedFamily?.name ?? "No family selected";
  const userHandle = isAuthLoading ? "Loading..." : user?.email ?? "Not signed in";
  const mobilePrimary = links.slice(0, 4);

  return (
    <>
      <aside className="app-rail hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[17rem] lg:flex-col">
        <div className="app-brand-block">
          <Link href="/dashboard" className="flex items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <p className="app-brand-name">HomeFund</p>
              <p className="app-brand-family">{familyName}</p>
            </div>
          </Link>
        </div>

        <nav className="app-nav-list flex-1 overflow-y-auto">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return <NavLinkItem key={link.href} link={link} active={active} />;
          })}
        </nav>

        <div className="app-rail-footer space-y-3">
          <div className="app-session-note">
            <p className="font-semibold">Session</p>
            <p className="mt-1 truncate">{userHandle}</p>
          </div>
          <ThemePicker compact className="w-full justify-start" />
          <ThemeToggle compact className="w-full justify-start" />
          {!isAuthLoading && user ? (
            <LogoutButton />
          ) : (
            <Link href="/login" className="btn btn-ghost w-full justify-start">
              Log in
            </Link>
          )}
        </div>
      </aside>

      <nav className="mobile-toolbar sticky top-0 z-50 px-4 py-3 lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="mobile-menu-button btn btn-ghost h-11 w-11 flex-none px-0"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
              {mobileOpen ? <path d="M6 6 18 18M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>

          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <p className="mobile-family-name">{familyName}</p>
              <p className="mobile-brand-name">HomeFund</p>
            </div>
          </Link>

          <ThemePicker compact iconOnly className="h-11 w-11 flex-none px-0" />
          <ThemeToggle compact iconOnly className="h-11 w-11 flex-none px-0" />
        </div>

        <div className="mobile-quick-nav mt-3 grid grid-cols-4">
          {mobilePrimary.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`mobile-quick-link ${active ? "mobile-quick-link-active" : ""}`}
              >
                <span className="mb-1">{link.icon}</span>
                <span className="truncate">{link.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="mobile-drawer absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col px-4 py-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={() => setMobileOpen(false)}>
                <BrandMark />
                <div className="min-w-0">
                  <p className="mobile-family-name">{familyName}</p>
                  <p className="mobile-brand-name">HomeFund</p>
                </div>
              </Link>
              <button type="button" className="btn btn-ghost h-11 w-11 flex-none rounded-2xl px-0" onClick={() => setMobileOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5">
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="app-session-note mb-4">
              <p className="font-semibold">Signed in as</p>
              <p className="mt-1 truncate">{userHandle}</p>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto">
              {links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return <NavLinkItem key={link.href} link={link} active={active} onClick={() => setMobileOpen(false)} />;
              })}
            </div>

            <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <ThemePicker compact className="w-full justify-start" />
              <ThemeToggle compact className="w-full justify-start" />
              {!isAuthLoading && user ? (
                <LogoutButton />
              ) : (
                <Link href="/login" className="btn btn-ghost w-full justify-start" onClick={() => setMobileOpen(false)}>
                  Log in
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
