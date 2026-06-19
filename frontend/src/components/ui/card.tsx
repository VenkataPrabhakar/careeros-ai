import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/10 bg-[var(--card)] p-5 shadow-[0_20px_80px_rgba(4,8,24,0.22)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
