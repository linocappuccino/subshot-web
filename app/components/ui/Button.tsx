"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-950/40",
  secondary: "bg-white/8 hover:bg-white/14 text-white border border-white/10",
  ghost: "hover:bg-white/8 text-white/70 hover:text-white",
  danger: "bg-red-600/90 hover:bg-red-500 text-white",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2.5 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: HTMLMotionProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 25 }}
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({
  className,
  children,
  size = 36,
  ...props
}: HTMLMotionProps<"button"> & { size?: number }) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 25 }}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors",
        className
      )}
      {...props}
    >
      {children}
    </motion.button>
  );
}
