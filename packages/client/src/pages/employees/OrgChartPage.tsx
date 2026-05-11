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
        {/* #370 — Card was hard-pinned at w-48 (192px) which was too narrow
            for typical Indian full names + designations: long values like
            "Senior Software Engineer" or "Chandrasekhar Subramaniam"
            overflowed the card edge. Bumped to w-56, dropped text-center
            so the avatar + label stack reads top-aligned, added min-w-0 +
            truncate so anything still longer than the card shrinks
            gracefully with an ellipsis instead of breaking the layout. */}
        <Card className="w-56 transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col items-center gap-1 py-3">
            <Avatar name={node.name} size="sm" />
            <div className="mt-1 w-full min-w-0 text-center">
              <p className="truncate text-sm font-semibold text-gray-900" title={node.name}>
                {node.name}
              </p>
              <p className="truncate text-xs text-gray-500" title={node.designation || ""}>
                {node.designation || "—"}
              </p>
            </div>
            {node.department && (
              <Badge variant="draft" className="mt-1 max-w-full truncate">
                {node.department}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      {node.children.length > 0 && (
        <div className="relative mt-6">
          {/* Vertical line down */}
          <div className="absolute -top-6 left-1/2 h-6 w-px -translate-x-1/2 bg-gray-300" />

          {/* Horizontal line connecting children — span the full width of
              the children row so siblings on the far edges still read as
              connected. The previous calc(100/(n*2)) inset was based on
              equal column widths but the flex children use gap-6 + their
              own intrinsic widths, so the line frequently stopped short
              of the outer cards (#370). */}
          {node.children.length > 1 && (
            <div className="absolute -top-px left-0 right-0 h-px bg-gray-300" />
          )}

          <div className="flex flex-wrap justify-center gap-6">
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
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
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
        <CardContent className="overflow-x-auto overflow-y-auto py-8" style={{ maxHeight: "70vh" }}>
          <div
            className="flex justify-center"
            style={{ minWidth: `${Math.max(600, employees.length * 60)}px` }}
          >
            {tree.map((root) => (
              <OrgNodeCard key={root.id} node={root} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Department grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(deptMap)
          .sort((a, b) => b[1].length - a[1].length)
          .map(([dept, emps]) => (
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
                        <p className="text-xs font-medium text-gray-900">
                          {emp.first_name} {emp.last_name}
                        </p>
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
