"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAppState } from "@/context/AppState";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

export function AppNav() {
  const { user, selectedFamily, isAuthLoading } = useAppState();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/transactions", label: "Activity" },
    { href: "/loans", label: "Loans" },
    { href: "/recurring", label: "Recurring" },
    { href: "/categories", label: "Categories" },
    { href: "/accounts", label: "Accounts" },
    { href: "/families", label: "Family" },
  ];

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };

    mediaQuery.addEventListener("change", closeOnDesktop);
    return () => {
      mediaQuery.removeEventListener("change", closeOnDesktop);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    return lockBodyScroll();
  }, [mobileOpen]);

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/dashboard" className="text-xl font-semibold text-ink-900">
            HomeFund
          </Link>
          {selectedFamily?.name && <p className="mt-1 text-xs text-slate-500">Family: {selectedFamily.name}</p>}
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          {isAuthLoading && <p>Loading session...</p>}
          {!isAuthLoading && user?.email && <p className="truncate">{user.email}</p>}
          <div className="mt-2 space-y-2">
            <ThemeToggle compact className="w-full justify-start" />
            {!isAuthLoading && user ? (
              <LogoutButton />
            ) : (
              <Link href="/login" className="text-emerald-700">
                Log in
              </Link>
            )}
          </div>
        </div>
      </aside>

      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Open menu"
            className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span className="block h-0.5 w-5 bg-slate-700" />
            <span className="mt-1 block h-0.5 w-5 bg-slate-700" />
            <span className="mt-1 block h-0.5 w-5 bg-slate-700" />
          </button>
          <Link href="/dashboard" className="font-semibold text-lg text-ink-900">
            HomeFund
          </Link>
          <div className="text-xs text-slate-500">
            {isAuthLoading ? "..." : user?.email?.split("@")[0] ?? ""}
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/35"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[84%] max-w-xs border-r border-slate-200 bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Link href="/dashboard" className="text-lg font-semibold text-ink-900" onClick={() => setMobileOpen(false)}>
                HomeFund
              </Link>
              <button type="button" className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => setMobileOpen(false)}>
                Close
              </button>
            </div>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              {selectedFamily?.name ? `Family: ${selectedFamily.name}` : "No family selected"}
            </div>
            <div className="space-y-1">
              {links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
              {!isAuthLoading && user?.email && <p className="mb-2 truncate">{user.email}</p>}
              <ThemeToggle compact className="mb-2 w-full justify-start" />
              {!isAuthLoading && user ? (
                <LogoutButton />
              ) : (
                <Link href="/login" className="text-emerald-700" onClick={() => setMobileOpen(false)}>
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
