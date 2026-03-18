import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { useEmployees } from "@/api/hooks";
import { Loader2 } from "lucide-react";

interface OrgNode {
  id: string;
  name: string;
  designation: string;
  department: string;
  code: string;
  children: OrgNode[];
}

function buildTree(employees: any[]): OrgNode[] {
  const empMap: Record<string, OrgNode> = {};

  // Create nodes
  for (const emp of employees) {
    empMap[emp.id] = {
      id: emp.id,
      name: `${emp.first_name} ${emp.last_name}`,
      designation: emp.designation,
      department: emp.department,
      code: emp.employee_code,
      children: [],
    };
  }

  const roots: OrgNode[] = [];

  // Build tree
  for (const emp of employees) {
    if (emp.reporting_manager_id && empMap[emp.reporting_manager_id]) {
      empMap[emp.reporting_manager_id].children.push(empMap[emp.id]);
    } else {
      roots.push(empMap[emp.id]);
    }
  }

  // If no hierarchy, group by department
  if (roots.length === employees.length && employees.length > 3) {
    const deptMap: Record<string, OrgNode[]> = {};
    for (const node of roots) {
      if (!deptMap[node.department]) deptMap[node.department] = [];
      deptMap[node.department].push(node);
    }

    // Find most senior person (by role or first in list)
    const topNode = roots[0];
    topNode.children = roots.slice(1);
    return [topNode];
  }

  return roots;
}

function OrgNodeCard({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {depth > 0 && (
          <div className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-gray-300" />
        )}
        <Card className="w-48 hover:shadow-md transition-shadow">
          <CardContent className="py-3 text-center">
            <Avatar name={node.name} size="sm" className="mx-auto" />
            <p className="mt-2 text-sm font-semibold text-gray-900">{node.name}</p>
            <p className="text-xs text-gray-500">{node.designation}</p>
            <Badge variant="draft" className="mt-1">{node.department}</Badge>
          </CardContent>
        </Card>
      </div>

      {node.children.length > 0 && (
        <div className="relative mt-6">
          {/* Vertical line down */}
          <div className="absolute left-1/2 -top-6 h-6 w-px -translate-x-1/2 bg-gray-300" />

          {/* Horizontal line connecting children */}
          {node.children.length > 1 && (
            <div
              className="absolute -top-px h-px bg-gray-300"
              style={{
                left: `${100 / (node.children.length * 2)}%`,
                right: `${100 / (node.children.length * 2)}%`,
              }}
            />
          )}

          <div className="flex gap-8">
            {node.children.map((child) => (
              <OrgNodeCard key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function OrgChartPage() {
  const { data: res, isLoading } = useEmployees({ limit: 100 });
  const employees = res?.data?.data || [];

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const tree = buildTree(employees);

  // Also show department summary
  const deptMap: Record<string, any[]> = {};
  for (const emp of employees) {
    if (!deptMap[emp.department]) deptMap[emp.department] = [];
    deptMap[emp.department].push(emp);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Organization Chart"
        description={`${employees.length} employees across ${Object.keys(deptMap).length} departments`}
      />

      {/* Org tree */}
      <Card>
        <CardContent className="overflow-x-auto py-8">
          <div className="flex justify-center min-w-[600px]">
            {tree.map((root) => (
              <OrgNodeCard key={root.id} node={root} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Department grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(deptMap).sort((a, b) => b[1].length - a[1].length).map(([dept, emps]) => (
          <Card key={dept}>
            <CardContent className="py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{dept}</h3>
                <Badge variant="draft">{emps.length}</Badge>
              </div>
              <div className="space-y-2">
                {emps.map((emp: any) => (
                  <div key={emp.id} className="flex items-center gap-2">
                    <Avatar name={`${emp.first_name} ${emp.last_name}`} size="sm" />
                    <div>
                      <p className="text-xs font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-gray-400">{emp.designation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
