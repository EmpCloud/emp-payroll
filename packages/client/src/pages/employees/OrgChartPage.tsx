import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { useEmployees } from "@/api/hooks";
import {
  Loader2,
  Users,
  Briefcase,
  Building2,
  Network,
  Search,
  Plus,
  Minus,
  Maximize,
  Maximize2,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Employees with no department were previously bucketed under the literal
// key `null` (rendered as a "null" heading). Normalise everywhere.
// ---------------------------------------------------------------------------
const UNASSIGNED = "Unassigned";
function deptLabel(dept?: string | null): string {
  return dept && String(dept).trim() ? String(dept) : UNASSIGNED;
}

// Deterministic pastel gradient per department so a team reads with the same
// hue wherever it appears (mirrors the EmpCloud org chart).
const DEPT_GRADIENTS = [
  "from-indigo-200 to-violet-200",
  "from-sky-200 to-cyan-200",
  "from-emerald-200 to-teal-200",
  "from-amber-200 to-orange-200",
  "from-rose-200 to-pink-200",
  "from-purple-200 to-fuchsia-200",
];
function deptGradient(dept: string): string {
  if (dept === UNASSIGNED) return "from-gray-200 to-gray-300";
  let hash = 0;
  for (let i = 0; i < dept.length; i++) hash = (hash * 31 + dept.charCodeAt(i)) | 0;
  return DEPT_GRADIENTS[Math.abs(hash) % DEPT_GRADIENTS.length];
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type NodeKind = "person" | "group" | "root";

interface OrgNode {
  id: string;
  name: string;
  designation: string;
  department: string;
  kind: NodeKind;
  count?: number;
  children: OrgNode[];
}

/**
 * Build the chart tree from the flat employee list.
 * - When a reporting hierarchy exists (reporting_manager_id links), render the
 *   real reporting tree (a forest of top-level managers).
 * - When there is NO hierarchy at all, group people by department under a
 *   synthetic "Organization" root so the chart is still meaningful instead of
 *   a flat column of disconnected cards.
 */
function buildTree(employees: any[]): OrgNode[] {
  const byId: Record<string, OrgNode> = {};
  for (const emp of employees) {
    byId[emp.id] = {
      id: String(emp.id),
      name: `${emp.first_name} ${emp.last_name}`.trim(),
      designation: emp.designation || "",
      department: deptLabel(emp.department),
      kind: "person",
      children: [],
    };
  }

  const hasHierarchy = employees.some(
    (e) => e.reporting_manager_id && byId[e.reporting_manager_id],
  );

  if (hasHierarchy) {
    const roots: OrgNode[] = [];
    for (const emp of employees) {
      const mgr = emp.reporting_manager_id ? byId[emp.reporting_manager_id] : null;
      if (mgr && mgr.id !== String(emp.id)) mgr.children.push(byId[emp.id]);
      else roots.push(byId[emp.id]);
    }
    return roots;
  }

  // No reporting lines — group by department.
  const groups = new Map<string, OrgNode[]>();
  for (const emp of employees) {
    const key = byId[emp.id].department;
    const arr = groups.get(key);
    if (arr) arr.push(byId[emp.id]);
    else groups.set(key, [byId[emp.id]]);
  }
  const groupNodes = Array.from(groups, ([dept, people]) => ({
    id: `dept:${dept}`,
    name: dept,
    designation: "",
    department: dept,
    kind: "group" as const,
    count: people.length,
    children: people,
  })).sort((a, b) => {
    if (a.name === UNASSIGNED) return 1;
    if (b.name === UNASSIGNED) return -1;
    return b.children.length - a.children.length;
  });

  return [
    {
      id: "root",
      name: "Organization",
      designation: "",
      department: "",
      kind: "root",
      count: employees.length,
      children: groupNodes,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Card for a single node (person / department group / root)         */
/* ------------------------------------------------------------------ */
function NodeCard({
  node,
  onNavigate,
  isHighlighted,
  hasChildren,
}: {
  node: OrgNode;
  onNavigate: (id: string) => void;
  isHighlighted: boolean;
  hasChildren: boolean;
}) {
  if (node.kind !== "person") {
    const isRoot = node.kind === "root";
    return (
      <div
        data-node-id={node.id}
        className={`w-[220px] overflow-hidden rounded-2xl border bg-white shadow-sm ${
          isHighlighted ? "border-brand-400 ring-brand-300 ring-2 ring-offset-2" : "border-gray-200"
        }`}
      >
        <div
          className={`h-1 w-full bg-gradient-to-r ${
            isRoot ? "from-brand-400 to-indigo-400" : deptGradient(node.department)
          }`}
        />
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isRoot ? "bg-brand-50 text-brand-600" : "bg-gray-100 text-gray-600"
            }`}
          >
            {isRoot ? <Network className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900" title={node.name}>
              {node.name}
            </p>
            <p className="text-xs text-gray-500">
              {node.count} {node.count === 1 ? "person" : "people"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const unassigned = node.department === UNASSIGNED;
  return (
    <button
      data-node-id={node.id}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(node.id);
      }}
      className={`group relative w-[220px] overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        isHighlighted
          ? "border-brand-400 ring-brand-300 ring-2 ring-offset-2"
          : "hover:border-brand-200 border-gray-200"
      }`}
    >
      <div className={`h-1 w-full bg-gradient-to-r ${deptGradient(node.department)}`} />
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar
              name={node.name}
              size="lg"
              className={hasChildren ? "ring-brand-100 ring-2" : "ring-2 ring-gray-100"}
            />
            {hasChildren && (
              <span className="bg-brand-500 absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-white">
                {node.children.length}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="group-hover:text-brand-600 truncate text-sm font-semibold text-gray-900">
              {node.name}
            </p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-gray-600">
              {node.designation || "—"}
            </p>
            <span
              className={`mt-1 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                unassigned ? "bg-gray-50 text-gray-400" : "bg-gray-100 text-gray-600"
              }`}
            >
              {node.department}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Recursive tree node with CSS connectors + per-node collapse       */
/* ------------------------------------------------------------------ */
function ChartNode({
  node,
  onNavigate,
  level = 0,
  highlightedId,
  openIds,
}: {
  node: OrgNode;
  onNavigate: (id: string) => void;
  level?: number;
  highlightedId: string | null;
  openIds: Set<string>;
}) {
  const [expanded, setExpanded] = useState(level < 2);
  const hasChildren = node.children.length > 0;

  // When a search hit lands under this node, open it so the match is visible.
  // Opens the local state (rather than forcing) so the user keeps full manual
  // collapse control afterwards.
  useEffect(() => {
    if (openIds.has(node.id)) setExpanded(true);
  }, [openIds, node.id]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <NodeCard
          node={node}
          onNavigate={onNavigate}
          isHighlighted={highlightedId === node.id}
          hasChildren={hasChildren}
        />
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 absolute -bottom-3 left-1/2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm"
            title={expanded ? "Collapse" : `Expand ${node.children.length} reports`}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="flex flex-col items-center">
          <div className="h-7 w-0.5 bg-gradient-to-b from-gray-200 to-gray-300" />
          <div className="relative flex gap-10">
            {node.children.length > 1 && (
              <div
                className="absolute top-0 h-0.5 bg-gray-300"
                style={{
                  left: `calc(50% / ${node.children.length})`,
                  right: `calc(50% / ${node.children.length})`,
                }}
              />
            )}
            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="h-5 w-0.5 bg-gray-300" />
                <ChartNode
                  node={child}
                  onNavigate={onNavigate}
                  level={level + 1}
                  highlightedId={highlightedId}
                  openIds={openIds}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page — pannable / zoomable viewport                          */
/* ------------------------------------------------------------------ */
type StatMode = "people" | "managers" | "departments" | null;

interface FlatPerson {
  id: string;
  name: string;
  designation: string;
  department: string;
  reports: number;
}

export function OrgChartPage() {
  const navigate = useNavigate();
  const { data: res, isLoading } = useEmployees({ limit: 500 });
  const employees = res?.data?.data || [];

  const tree = useMemo(() => buildTree(employees), [employees]);

  // Flatten person nodes for stats / search / modal lists.
  const flatPeople = useMemo(() => {
    const out: FlatPerson[] = [];
    const walk = (n: OrgNode) => {
      if (n.kind === "person") {
        out.push({
          id: n.id,
          name: n.name,
          designation: n.designation,
          department: n.department,
          reports: n.children.length,
        });
      }
      n.children.forEach(walk);
    };
    tree.forEach(walk);
    return out;
  }, [tree]);

  const stats = useMemo(() => {
    const managers = flatPeople.filter((p) => p.reports > 0).length;
    const departments = new Set(
      flatPeople.map((p) => p.department).filter((d) => d && d !== UNASSIGNED),
    ).size;
    return { total: flatPeople.length, managers, departments };
  }, [flatPeople]);

  const departmentList = useMemo(() => {
    const byDept = new Map<string, FlatPerson[]>();
    for (const p of flatPeople) {
      const arr = byDept.get(p.department);
      if (arr) arr.push(p);
      else byDept.set(p.department, [p]);
    }
    return Array.from(byDept, ([name, people]) => ({ name, people })).sort((a, b) => {
      if (a.name === UNASSIGNED) return 1;
      if (b.name === UNASSIGNED) return -1;
      return b.people.length - a.people.length;
    });
  }, [flatPeople]);

  // Search
  const [search, setSearch] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return flatPeople
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.designation.toLowerCase().includes(q) ||
          p.department.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [flatPeople, search]);

  const [statModal, setStatModal] = useState<StatMode>(null);

  // --- pan / zoom state ---
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateAtStart = useRef({ x: 0, y: 0 });

  const handleNavigate = useCallback((id: string) => navigate(`/employees/${id}`), [navigate]);

  // Parent lookup so a search hit can open its ancestors and pan to it.
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (n: OrgNode, parent?: string) => {
      if (parent) m.set(n.id, parent);
      n.children.forEach((c) => walk(c, n.id));
    };
    tree.forEach((r) => walk(r));
    return m;
  }, [tree]);

  // Memoised tree so panning/zooming (translate/scale state) doesn't re-render
  // every card — only the transform wrapper updates.
  const treeContent = useMemo(
    () => (
      <>
        {tree.map((root) => (
          <ChartNode
            key={root.id}
            node={root}
            onNavigate={handleNavigate}
            highlightedId={highlightedId}
            openIds={openIds}
          />
        ))}
      </>
    ),
    [tree, handleNavigate, highlightedId, openIds],
  );

  // Pan the viewport so a given node's card sits at the centre.
  const centerOnNode = useCallback((id: string) => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const el = content.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const nRect = el.getBoundingClientRect();
    const nodeCx = nRect.left + nRect.width / 2 - cRect.left;
    const nodeCy = nRect.top + nRect.height / 2 - cRect.top;
    setTranslate((t) => ({
      x: t.x + (cRect.width / 2 - nodeCx),
      y: t.y + (cRect.height / 2 - nodeCy),
    }));
  }, []);

  // Jump to a person from search: open their ancestors, highlight, then centre.
  const focusPerson = useCallback(
    (id: string) => {
      const ancestors = new Set<string>();
      let cur = parentOf.get(id);
      while (cur) {
        ancestors.add(cur);
        cur = parentOf.get(cur);
      }
      setOpenIds(ancestors);
      setHighlightedId(id);
      setSearch("");
      // Let the ancestor cards expand (and lay out) before centring.
      setTimeout(() => centerOnNode(id), 90);
    },
    [parentOf, centerOnNode],
  );

  // Wheel zoom anchored to the cursor.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setScale((prev) => {
      const next = clamp(prev + delta, 0.15, 2.5);
      const ratio = next / prev;
      setTranslate((t) => ({ x: cx - ratio * (cx - t.x), y: cy - ratio * (cy - t.y) }));
      return next;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Mouse drag-to-pan.
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateAtStart.current = { ...translate };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTranslate({
      x: translateAtStart.current.x + (e.clientX - dragStart.current.x),
      y: translateAtStart.current.y + (e.clientY - dragStart.current.y),
    });
  };
  const endDrag = () => setIsDragging(false);

  // Touch: single-finger pan + two-finger pinch-zoom. `touch-action: none` on
  // the container stops the browser from scrolling/zooming so we own gestures.
  const gesture = useRef({
    mode: "none" as "none" | "pan" | "pinch",
    startX: 0,
    startY: 0,
    tx: 0,
    ty: 0,
    startDist: 1,
    startScale: 1,
    anchorX: 0,
    anchorY: 0,
  });
  const onTouchStart = (e: React.TouchEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const g = gesture.current;
    if (e.touches.length === 1) {
      g.mode = "pan";
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.tx = translate.x;
      g.ty = translate.y;
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      g.mode = "pinch";
      g.startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      g.startScale = scale;
      g.tx = translate.x;
      g.ty = translate.y;
      g.anchorX = (a.clientX + b.clientX) / 2 - rect.left;
      g.anchorY = (a.clientY + b.clientY) / 2 - rect.top;
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.mode === "pan" && e.touches.length === 1) {
      setTranslate({
        x: g.tx + (e.touches[0].clientX - g.startX),
        y: g.ty + (e.touches[0].clientY - g.startY),
      });
    } else if (g.mode === "pinch" && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
      const next = clamp(g.startScale * (dist / g.startDist), 0.15, 2.5);
      const ratio = next / g.startScale;
      setScale(next);
      setTranslate({
        x: g.anchorX - ratio * (g.anchorX - g.tx),
        y: g.anchorY - ratio * (g.anchorY - g.ty),
      });
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 0) g.mode = "none";
    else if (e.touches.length === 1) {
      g.mode = "pan";
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.tx = translate.x;
      g.ty = translate.y;
    }
  };

  // Zoom buttons — anchored to the viewport centre.
  const zoomBy = (delta: number) => {
    const el = containerRef.current;
    setScale((prev) => {
      const next = clamp(prev + delta, 0.15, 2.5);
      if (el) {
        const rect = el.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = next / prev;
        setTranslate((t) => ({ x: cx - ratio * (cx - t.x), y: cy - ratio * (cy - t.y) }));
      }
      return next;
    });
  };

  // Fit the whole chart into the viewport.
  const fitToScreen = useCallback(() => {
    const c = containerRef.current;
    const ct = contentRef.current;
    if (!c || !ct) return;
    const cr = c.getBoundingClientRect();
    const tr = ct.getBoundingClientRect();
    const naturalW = tr.width / scale;
    const naturalH = tr.height / scale;
    if (naturalW <= 0 || naturalH <= 0) return;
    const pad = 64;
    const fit = clamp(
      Math.min((cr.width - pad) / naturalW, (cr.height - pad) / naturalH),
      0.15,
      1.2,
    );
    setScale(fit);
    setTranslate({ x: (cr.width - naturalW * fit) / 2, y: (cr.height - naturalH * fit) / 2 });
  }, [scale]);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen();
    }
  };

  // Re-fit shortly after entering/exiting fullscreen.
  useEffect(() => {
    const onFsChange = () => setTimeout(fitToScreen, 120);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fitToScreen]);

  // Auto-fit once the data has rendered.
  const didFit = useRef(false);
  useEffect(() => {
    if (employees.length > 0 && !didFit.current) {
      const id = setTimeout(() => {
        fitToScreen();
        didFit.current = true;
      }, 200);
      return () => clearTimeout(id);
    }
  }, [employees.length, fitToScreen]);

  const zoomPercent = Math.round(scale * 100);

  const statPills = !isLoading && employees.length > 0 && (
    <div className="hidden items-center gap-2 sm:flex">
      <StatPill
        icon={Users}
        accent="text-indigo-500"
        hover="hover:border-indigo-300 hover:bg-indigo-50"
        label="People"
        value={stats.total}
        onClick={() => setStatModal("people")}
      />
      <StatPill
        icon={Briefcase}
        accent="text-emerald-500"
        hover="hover:border-emerald-300 hover:bg-emerald-50"
        label="Managers"
        value={stats.managers}
        onClick={() => setStatModal("managers")}
      />
      <StatPill
        icon={Building2}
        accent="text-amber-500"
        hover="hover:border-amber-300 hover:bg-amber-50"
        label="Departments"
        value={stats.departments}
        onClick={() => setStatModal("departments")}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Organization Chart"
        description="Reporting structure — drag to pan, scroll or pinch to zoom"
        actions={statPills}
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-24 text-center">
          <div className="rounded-full bg-gray-50 p-3">
            <Users className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-sm text-gray-400">No employees to chart yet.</p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, roles, departments…"
              aria-label="Search the org chart"
              className="focus:border-brand-300 focus:ring-brand-100 w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm outline-none transition focus:ring-2"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setHighlightedId(null);
                  setOpenIds(new Set());
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {searchResults.length > 0 && (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => focusPerson(p.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <Avatar name={p.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {p.designation || "—"}
                        {p.department !== UNASSIGNED ? ` · ${p.department}` : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pannable / zoomable viewport */}
          <div
            ref={containerRef}
            className="relative h-[calc(100vh-16rem)] min-h-[520px] overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-slate-100"
            style={{
              cursor: isDragging ? "grabbing" : "grab",
              touchAction: "none",
              backgroundImage: "radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Zoom controls */}
            <div className="absolute right-4 top-4 z-20 flex flex-col gap-1.5">
              <ControlButton title="Zoom in" onClick={() => zoomBy(0.15)}>
                <Plus className="h-4 w-4" />
              </ControlButton>
              <div className="select-none text-center text-[10px] font-medium text-gray-400">
                {zoomPercent}%
              </div>
              <ControlButton title="Zoom out" onClick={() => zoomBy(-0.15)}>
                <Minus className="h-4 w-4" />
              </ControlButton>
              <ControlButton title="Fit to screen" onClick={fitToScreen} className="mt-1">
                <Maximize className="h-4 w-4" />
              </ControlButton>
              <ControlButton title="Fullscreen" onClick={toggleFullscreen}>
                <Maximize2 className="h-4 w-4" />
              </ControlButton>
            </div>

            {/* Hint */}
            <div className="pointer-events-none absolute bottom-3 left-3 z-20 select-none text-[11px] text-gray-400">
              Drag to pan · scroll to zoom · pinch on touch
            </div>

            {/* Transform layer */}
            <div
              ref={contentRef}
              style={{
                transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                transformOrigin: "0 0",
              }}
              className="inline-flex select-none flex-col items-center gap-6 p-12"
            >
              {treeContent}
            </div>
          </div>
        </>
      )}

      <StatListModal
        mode={statModal}
        onClose={() => setStatModal(null)}
        people={flatPeople}
        managers={flatPeople.filter((p) => p.reports > 0)}
        departments={departmentList}
        onNavigate={(id) => {
          setStatModal(null);
          handleNavigate(id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */
function ControlButton({
  onClick,
  title,
  children,
  className,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 ${
        className || ""
      }`}
    >
      {children}
    </button>
  );
}

function StatPill({
  icon: Icon,
  accent,
  hover,
  label,
  value,
  onClick,
}: {
  icon: any;
  accent: string;
  hover: string;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`View all ${label.toLowerCase()}`}
      className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-200 ${hover}`}
    >
      <Icon className={`h-4 w-4 ${accent}`} />
      <div className="text-left">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-gray-900">{value}</p>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat modal (People / Managers / Departments)                      */
/* ------------------------------------------------------------------ */
function StatListModal({
  mode,
  onClose,
  people,
  managers,
  departments,
  onNavigate,
}: {
  mode: StatMode;
  onClose: () => void;
  people: FlatPerson[];
  managers: FlatPerson[];
  departments: { name: string; people: FlatPerson[] }[];
  onNavigate: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  useEffect(() => {
    setFilter("");
  }, [mode]);

  if (!mode) return null;

  const q = filter.trim().toLowerCase();
  const matchPerson = (p: FlatPerson) =>
    !q ||
    p.name.toLowerCase().includes(q) ||
    p.designation.toLowerCase().includes(q) ||
    p.department.toLowerCase().includes(q);

  const title =
    mode === "people"
      ? `All People (${people.length})`
      : mode === "managers"
        ? `Managers (${managers.length})`
        : `Departments (${departments.length})`;

  const list = mode === "managers" ? managers : people;

  return (
    <Modal open onClose={onClose} title={title} className="max-w-xl">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={mode === "departments" ? "Filter departments…" : "Filter people…"}
          className="focus:border-brand-300 focus:ring-brand-100 w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2"
        />
      </div>

      {mode === "departments" ? (
        <DepartmentList
          departments={departments
            .map((d) => ({ ...d, people: d.people.filter(matchPerson) }))
            .filter((d) => (!q ? true : d.name.toLowerCase().includes(q) || d.people.length > 0))}
          onNavigate={onNavigate}
        />
      ) : (
        <PersonList people={list.filter(matchPerson)} onNavigate={onNavigate} />
      )}
    </Modal>
  );
}

function PersonList({
  people,
  onNavigate,
}: {
  people: FlatPerson[];
  onNavigate: (id: string) => void;
}) {
  if (people.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-gray-400">No matches.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {people.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onNavigate(p.id)}
            className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-gray-50"
          >
            <Avatar name={p.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
              <p className="truncate text-xs text-gray-500">
                {p.designation || "—"}
                {p.department !== UNASSIGNED ? ` · ${p.department}` : ""}
              </p>
            </div>
            {p.reports > 0 && (
              <span className="text-brand-600 bg-brand-50 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                {p.reports} report{p.reports === 1 ? "" : "s"}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DepartmentList({
  departments,
  onNavigate,
}: {
  departments: { name: string; people: FlatPerson[] }[];
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (departments.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-gray-400">No matches.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {departments.map((d) => {
        const expanded = open === d.name;
        return (
          <li key={d.name}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : d.name)}
              className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-gray-50"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  d.name === UNASSIGNED ? "bg-gray-100 text-gray-500" : "bg-amber-50 text-amber-600"
                }`}
              >
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{d.name}</p>
                <p className="text-xs text-gray-500">
                  {d.people.length} {d.people.length === 1 ? "person" : "people"}
                </p>
              </div>
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
            </button>
            {expanded && d.people.length > 0 && (
              <div className="mb-2 ml-7 border-l-2 border-gray-100 pl-1">
                <PersonList people={d.people} onNavigate={onNavigate} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
