"use client";
import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { useAppState } from "@/context/AppState";

export function AppNav() {
  const { user } = useAppState();
  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/families", label: "Families" },
    { href: "/accounts", label: "Accounts" },
    { href: "/transactions", label: "Transactions" },
    { href: "/goals", label: "Goals" },
    { href: "/loans", label: "Loans" },
  ];

  return (
    <nav className="border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="font-semibold text-lg text-ink-900">Ledger</Link>
        <div className="flex items-center gap-6 text-sm text-slate-700">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink-900">
              {l.label}
            </Link>
          ))}
          <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
            {user?.email && <span className="text-xs text-slate-500">{user.email}</span>}
            <LogoutButton />
          </div>
        </div>
      </div>
    </nav>
  );
}
