import { cn } from "@/lib/utils";
import { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-[var(--foreground)] outline-none ring-0 placeholder:text-[var(--muted-foreground)] focus:border-[var(--brand)]",
        className,
      )}
      {...props}
    />
  );
}
