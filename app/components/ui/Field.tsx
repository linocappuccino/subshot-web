import { cn } from "@/lib/cn";

const fieldBase =
  "w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm placeholder:text-white/30 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, "resize-none", props.className)} />;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-white/50 uppercase tracking-wide mb-1.5">{children}</label>;
}

export function FieldGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4", className)}>{children}</div>;
}
