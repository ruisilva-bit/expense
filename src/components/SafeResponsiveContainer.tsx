"use client";

import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";

type Props = {
  minHeight?: number;
  className?: string;
  children: React.ReactNode;
};

type ChartElementProps = {
  width?: number;
  height?: number;
};

export function SafeResponsiveContainer({ minHeight = 220, className = "", children }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const update = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.max(0, Math.round(rect.height));
      if (width <= 0 || height <= 0) {
        setSize(null);
        return;
      }
      setSize((current) => {
        if (current && current.width === width && current.height === height) return current;
        return { width, height };
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={hostRef} className={`h-full w-full min-w-0 ${className}`} style={{ minHeight }}>
      {size && isValidElement<ChartElementProps>(children) ? (
        cloneElement<ChartElementProps>(children, {
          width: size.width,
          height: size.height,
        })
      ) : (
        <div className="h-full w-full animate-pulse rounded-xl bg-slate-100" />
      )}
    </div>
  );
}
