import { PT_SLABS } from "../constants/india";

export function professionalTaxAmount(
  state: string,
  gross: number,
  month: number,
  year: number,
): number {
  const value = state.trim().toUpperCase();
  const code =
    (
      {
        KARNATAKA: "KA",
        BANGALORE: "KA",
        BENGALURU: "KA",
        MAHARASHTRA: "MH",
        TELANGANA: "TS",
        "TAMIL NADU": "TN",
        DELHI: "DL",
      } as Record<string, string>
    )[value] || value;
  if (code === "KA" && (year > 2023 || (year === 2023 && month >= 4))) {
    if (gross < 25000) return 0;
    return month === 2 && year >= 2026 ? 300 : 200;
  }
  const tax = PT_SLABS[code]?.find((slab) => gross >= slab.min && gross <= slab.max)?.tax ?? 0;
  return code === "MH" && month === 2 && gross > 10000 ? 300 : tax;
}
