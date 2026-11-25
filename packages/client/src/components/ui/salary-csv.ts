export function parseSalaryCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() ?? [];
  return rows.map((values) => {
    const result: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!result[header] || values[index]) result[header] = values[index] || "";
    });
    return result;
  });
}

export function salaryTemplateCSV(employees: any[]): string {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [
    [
      "Employee ID",
      "Employee Code",
      "First Name",
      "Last Name",
      "Email",
      "Department",
      "Designation",
      "Annual CTC",
    ],
    ...employees.map((e) => [
      e.id,
      e.employeeCode,
      e.firstName,
      e.lastName,
      e.email,
      e.department,
      e.designation,
      e.annualCtc,
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
