"use client";

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-1"
    >
      {label && <span className="text-sm font-medium">{label}</span>}
      <span
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0"
        style={{ backgroundColor: checked ? "#3875bd" : "rgba(255,255,255,0.15)" }}
      >
        <span
          className="inline-block h-5 w-5 rounded-full bg-white shadow transition-[margin] duration-150"
          style={{ marginLeft: checked ? 22 : 2 }}
        />
      </span>
    </button>
  );
}
