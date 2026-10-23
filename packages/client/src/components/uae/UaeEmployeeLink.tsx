import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";

interface Person {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}
export function UaeEmployeeLink({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isFetching, isError } = useQuery({
    queryKey: ["uae-employee-link", search],
    queryFn: () => apiGet<Person[]>("/employees/search", { q: search, limit: 20 }),
    enabled: search.trim().length >= 2,
  });
  const people = data?.data || [];
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Employee payslip access</legend>
      <p className="text-xs text-gray-500">
        Link an existing EmpCloud employee in this organisation to enable payslips. The linked
        account must have the same email as this employee.
      </p>
      <Input
        label="Find EmpCloud employee by name or email"
        aria-label="Find EmpCloud employee by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <SelectField
        label="Linked EmpCloud employee"
        aria-label="Linked EmpCloud employee"
        value={value == null ? "" : String(value)}
        options={[
          { value: "", label: "Not linked" },
          ...(value != null && !people.some((person) => Number(person.id) === value)
            ? [{ value: String(value), label: `Linked EmpCloud user ${value}` }]
            : []),
          ...people.map((person) => ({
            value: String(person.id),
            label: `${person.first_name} ${person.last_name} (${person.email})`,
          })),
        ]}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      />
      {isFetching && <p className="text-xs text-gray-500">Searching organisation employees…</p>}
      {isError && (
        <p role="alert" className="text-sm text-amber-800">
          Could not search employees. Try again before linking an account.
        </p>
      )}
    </fieldset>
  );
}
