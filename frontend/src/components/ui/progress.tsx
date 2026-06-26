type ProgressProps = {
  value: number;
};

export function Progress({ value }: ProgressProps) {
  return (
    <div className="h-2.5 w-full rounded-full bg-white/8 shadow-inner">
      <div
        className="h-2.5 rounded-full bg-[linear-gradient(90deg,var(--brand),var(--brand-strong))] transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
