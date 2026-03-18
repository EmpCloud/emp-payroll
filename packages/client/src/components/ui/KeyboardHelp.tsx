import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";

const shortcuts = [
  { keys: ["Ctrl", "K"], description: "Open command palette", category: "General" },
  { keys: ["Esc"], description: "Close modal / palette", category: "General" },
  { keys: ["?"], description: "Show keyboard shortcuts", category: "General" },
  { keys: ["G", "D"], description: "Go to Dashboard", category: "Navigation" },
  { keys: ["G", "E"], description: "Go to Employees", category: "Navigation" },
  { keys: ["G", "P"], description: "Go to Payroll", category: "Navigation" },
  { keys: ["G", "S"], description: "Go to Settings", category: "Navigation" },
];

const NAV_KEYS: Record<string, string> = {
  d: "/",
  e: "/employees",
  p: "/payroll/runs",
  s: "/settings",
  r: "/reports",
  a: "/attendance",
};

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const gPressed = useRef(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      // "G then letter" navigation
      if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        gPressed.current = true;
        setTimeout(() => { gPressed.current = false; }, 500);
        return;
      }

      if (gPressed.current && NAV_KEYS[e.key]) {
        e.preventDefault();
        gPressed.current = false;
        navigate(NAV_KEYS[e.key]);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [navigate]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard Shortcuts" className="max-w-sm">
      {["General", "Navigation"].map((cat) => (
        <div key={cat} className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{cat}</h3>
          <div className="space-y-2">
            {shortcuts.filter((s) => s.category === cat).map((s) => (
              <div key={s.description} className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-300">{s.description}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((key) => (
                    <kbd
                      key={key}
                      className="inline-flex h-6 min-w-[24px] items-center justify-center rounded border border-gray-300 bg-gray-50 px-1.5 text-xs font-medium text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-center text-xs text-gray-400">Press <kbd className="rounded border px-1">?</kbd> again to close</p>
    </Modal>
  );
}
