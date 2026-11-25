import { describe, expect, it } from "vitest";
import { parseSalaryCSV, salaryTemplateCSV } from "./salary-csv";

describe("salary CSV template", () => {
  it("round trips employee names and annual salary, including blank salaries", () => {
    const csv = salaryTemplateCSV([
      {
        id: 17,
        employeeCode: "EMP1",
        firstName: 'Asha, "A"',
        lastName: "Shah",
        email: "a@example.com",
        annualCtc: 1200000,
      },
      { id: 18, employeeCode: "EMP2", firstName: "Ben", annualCtc: null },
    ]);
    expect(parseSalaryCSV(csv)).toEqual([
      {
        "Employee ID": "17",
        "Employee Code": "EMP1",
        "First Name": 'Asha, "A"',
        "Last Name": "Shah",
        Email: "a@example.com",
        Department: "",
        Designation: "",
        "Annual CTC": "1200000",
      },
      {
        "Employee ID": "18",
        "Employee Code": "EMP2",
        "First Name": "Ben",
        "Last Name": "",
        Email: "",
        Department: "",
        Designation: "",
        "Annual CTC": "",
      },
    ]);
  });
});
