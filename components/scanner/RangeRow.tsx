"use client";

interface RangeRowProps {
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  onChange: (field: "min" | "max", value?: number) => void;
  unitPosition?: "prefix" | "suffix";
}

export function RangeRow({ label, unit, min, max, onChange, unitPosition = "suffix" }: RangeRowProps) {
  const handleChange = (field: "min" | "max", raw: string) => {
    if (raw === "") {
      onChange(field, undefined);
      return;
    }
    const num = Number(raw);
    if (!isNaN(num)) onChange(field, num);
  };

  const inputStyle = {
    background: "var(--bg-primary)",
    borderColor: "var(--border)",
    color: "var(--text-primary)",
  };

  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className="text-xs font-medium shrink-0"
        style={{ color: "var(--text-secondary)", width: "30%" }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative flex-1">
          {unitPosition === "prefix" && unit && (
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            >
              {unit}
            </span>
          )}
          <input
            type="text"
            inputMode="decimal"
            placeholder="Min"
            value={min ?? ""}
            onChange={(e) => handleChange("min", e.target.value)}
            className="w-full h-8 rounded-lg text-xs border outline-none transition-colors"
            style={{
              ...inputStyle,
              paddingLeft: unitPosition === "prefix" && unit ? "1.25rem" : "0.625rem",
              paddingRight: unitPosition === "suffix" && unit ? "2.25rem" : "0.625rem",
            }}
          />
          {unitPosition === "suffix" && unit && (
            <span
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            >
              {unit}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>
        <div className="relative flex-1">
          {unitPosition === "prefix" && unit && (
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            >
              {unit}
            </span>
          )}
          <input
            type="text"
            inputMode="decimal"
            placeholder="Max"
            value={max ?? ""}
            onChange={(e) => handleChange("max", e.target.value)}
            className="w-full h-8 rounded-lg text-xs border outline-none transition-colors"
            style={{
              ...inputStyle,
              paddingLeft: unitPosition === "prefix" && unit ? "1.25rem" : "0.625rem",
              paddingRight: unitPosition === "suffix" && unit ? "2.25rem" : "0.625rem",
            }}
          />
          {unitPosition === "suffix" && unit && (
            <span
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            >
              {unit}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
