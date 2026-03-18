import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";

/**
 * Custom fields service — allows admins to define additional fields
 * on employee profiles without schema changes.
 *
 * Custom field values are stored as JSON in the employees table
 * (using a `custom_fields` JSON column or a separate table).
 *
 * For simplicity, we use an in-memory store + raw queries.
 */

export interface CustomFieldDefinition {
  id: string;
  orgId: string;
  name: string;
  code: string;         // snake_case identifier
  fieldType: "text" | "number" | "date" | "select" | "boolean";
  options?: string[];   // For select type
  isRequired: boolean;
  defaultValue?: string;
  section: string;      // Which section to show in: personal, employment, custom
  sortOrder: number;
}

export class CustomFieldsService {
  private static definitions: CustomFieldDefinition[] = [];
  private static values = new Map<string, Record<string, any>>(); // empId -> { fieldCode: value }

  async defineField(orgId: string, params: Omit<CustomFieldDefinition, "id" | "orgId">): Promise<CustomFieldDefinition> {
    const field: CustomFieldDefinition = {
      id: uuid(),
      orgId,
      ...params,
    };
    CustomFieldsService.definitions.push(field);
    return field;
  }

  async getDefinitions(orgId: string): Promise<CustomFieldDefinition[]> {
    return CustomFieldsService.definitions.filter((d) => d.orgId === orgId);
  }

  async deleteDefinition(orgId: string, fieldId: string): Promise<boolean> {
    const idx = CustomFieldsService.definitions.findIndex(
      (d) => d.id === fieldId && d.orgId === orgId
    );
    if (idx === -1) return false;
    CustomFieldsService.definitions.splice(idx, 1);
    return true;
  }

  async setValues(employeeId: string, values: Record<string, any>): Promise<Record<string, any>> {
    const existing = CustomFieldsService.values.get(employeeId) || {};
    const merged = { ...existing, ...values };
    CustomFieldsService.values.set(employeeId, merged);
    return merged;
  }

  async getValues(employeeId: string): Promise<Record<string, any>> {
    return CustomFieldsService.values.get(employeeId) || {};
  }

  async getBulkValues(employeeIds: string[]): Promise<Record<string, Record<string, any>>> {
    const result: Record<string, Record<string, any>> = {};
    for (const empId of employeeIds) {
      result[empId] = CustomFieldsService.values.get(empId) || {};
    }
    return result;
  }
}
