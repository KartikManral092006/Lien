import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A figure whose digits roll to each new value (NumberFlow), then tint for a moment to say whether the
 * change was good or bad for the account. `good` names the direction that helps: debt falling is good,
 * collateral falling is not. NumberFlow already skips the roll for people who ask for less motion.
 */
export function Num({
  value,
  digits = 2,
  prefix,
  good = "none",
  className,
}: {
  value: number;
  digits?: number;
  prefix?: string;
  good?: "up" | "down" | "none";
  className?: string;
}) {
  const prev = useRef(value);
  const [tint, setTint] = useState<"safe" | "danger" | "lasna" | null>(null);

  useEffect(() => {
    if (value === prev.current) return;
    const up = value > prev.current;
    prev.current = value;
    setTint(good === "none" ? "lasna" : (good === "up") === up ? "safe" : "danger");
    const t = setTimeout(() => setTint(null), 1100);
    return () => clearTimeout(t);
  }, [value, good]);

  return (
    <NumberFlow
      value={value}
      prefix={prefix}
      format={{ minimumFractionDigits: digits, maximumFractionDigits: digits }}
      spinTiming={{ duration: 750, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      className={cn(
        "tabular-nums transition-colors duration-700",
        tint === "safe" && "text-safe",
        tint === "danger" && "text-danger",
        tint === "lasna" && "text-chain-lasna",
        className,
      )}
    />
  );
}
