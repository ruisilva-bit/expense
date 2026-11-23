import type { Metadata } from "next";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Sign in | HomeFund",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="mx-auto flex max-w-6xl justify-end pb-4">
        <ThemeToggle compact />
      </div>
      <div className="auth-grid">
        <section className="auth-hero">
          <div>
            <p className="auth-eyebrow">Household finance</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
              Clear money visibility for the whole family.
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-600 dark:text-slate-300">
              HomeFund keeps balances, recurring costs, goals, loans, and day-to-day activity in one calm workspace built for fast mobile check-ins.
            </p>
          </div>

          <ul className="auth-list">
            <li>
              <span className="auth-bullet" />
              <span>Quick access to balances, reserves, and upcoming recurring costs.</span>
            </li>
            <li>
              <span className="auth-bullet" />
              <span>Shared visibility by family and account without changing the underlying finance rules.</span>
            </li>
            <li>
              <span className="auth-bullet" />
              <span>Compact, touch-friendly flows for adding or reviewing money movement on the go.</span>
            </li>
          </ul>
        </section>

        {children}
      </div>
    </div>
  );
}
