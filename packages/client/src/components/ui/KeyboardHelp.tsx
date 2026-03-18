import { useState, useEffect } from "react";
import { Modal } from "./Modal";

const shortcuts = [
  { keys: ["Ctrl", "K"], description: "Open command palette" },
  { keys: ["Esc"], description: "Close modal / palette" },
  { keys: ["↑", "↓"], description: "Navigate list items" },
  { keys: ["Enter"], description: "Select / confirm" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
];

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Only trigger on ? key when not in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard Shortcuts" className="max-w-sm">
      <div className="space-y-3">
        {shortcuts.map((s) => (
          <div key={s.description} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{s.description}</span>
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
      <p className="mt-4 text-center text-xs text-gray-400">Press <kbd className="rounded border px-1">?</kbd> again to close</p>
    </Modal>
  );
}
