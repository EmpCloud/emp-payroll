import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import type { UaeApprovedAmount } from "@emp-payroll/shared";
import { aedToFils, filsToAed } from "@/lib/uae-payroll";

export function UaeMoneyField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  required?: boolean;
}) {
  const [text, setText] = useState(filsToAed(value));
  useEffect(() => {
    if (!Number.isFinite(value)) return;
    try {
      if (aedToFils(text) === value) return;
    } catch {
      /* External reset. */
    }
    setText(filsToAed(value));
  }, [value]);
  const invalid = text !== "" && !/^\d+(?:\.\d{1,2})?$/.test(text);
  return (
    <Input
      aria-label={`${label} (AED)`}
      label={`${label} (AED)`}
      type="text"
      inputMode="decimal"
      value={text}
      required={required}
      error={invalid ? "Enter an AED amount with up to two decimal places." : undefined}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value) {
          onChange(required ? NaN : undefined);
          return;
        }
        try {
          onChange(aedToFils(e.target.value, label));
        } catch {
          onChange(NaN);
        }
      }}
    />
  );
}

export function UaeNumberField({
  label,
  value,
  onChange,
  max,
  integer = false,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  max?: number;
  integer?: boolean;
}) {
  return (
    <Input
      aria-label={label}
      label={label}
      type="number"
      min="0"
      max={max}
      step={integer ? "1" : "0.01"}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

export function UaeApprovedFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: UaeApprovedAmount;
  onChange: (value: UaeApprovedAmount | undefined) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <UaeMoneyField
        label={label}
        value={value?.amount}
        onChange={(amount) =>
          onChange(amount == null ? undefined : { amount, reference: value?.reference || "" })
        }
      />
      <Input
        aria-label={`${label} approval reference`}
        label="Approval / authority reference"
        value={value?.reference || ""}
        disabled={!value}
        onChange={(e) => value && onChange({ ...value, reference: e.target.value })}
      />
    </div>
  );
}

export function UaeCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
