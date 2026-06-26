import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-2xl text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,var(--brand),var(--brand-strong))] text-white shadow-[0_16px_40px_rgba(222,111,71,0.25)] hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(222,111,71,0.32)]",
        secondary: "bg-[var(--surface)] text-[var(--foreground)] hover:bg-white/12",
        outline: "border border-[var(--stroke)] bg-transparent text-[var(--foreground)] hover:bg-white/8",
        ghost: "text-[var(--muted-foreground)] hover:bg-white/8 hover:text-[var(--foreground)]",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 px-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
