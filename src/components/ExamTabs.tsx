"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type TabId = "setup" | "run" | "grade";

/**
 * Three-stage tabbed layout for managing one exam: Setup (write questions),
 * Run (start + proctor the live exam), Grade (review and release results).
 * All three panels stay mounted (hidden, not unmounted) so the Run panel keeps
 * its realtime subscription and auto-advance polling alive even when another
 * tab is showing.
 */
export function ExamTabs({
  status,
  setup,
  run,
  grade,
}: {
  status: string;
  setup: ReactNode;
  run: ReactNode;
  grade: ReactNode;
}) {
  const initial: TabId =
    status === "live"
      ? "run"
      : status === "closed" || status === "released"
      ? "grade"
      : "setup";
  const [tab, setTab] = useState<TabId>(initial);
  const router = useRouter();

  // Re-fetch server data (proctor list, student answers) when switching tabs,
  // so the Run/Grade panels never show data that was stale from page load.
  function select(id: TabId) {
    setTab(id);
    router.refresh();
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "setup", label: "1 · ตั้งค่า" },
    { id: "run", label: "2 · ดำเนินการสอบ" },
    { id: "grade", label: "3 · ตรวจให้คะแนน" },
  ];

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-brand text-brand"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={tab === "setup" ? "" : "hidden"}>{setup}</div>
      <div className={tab === "run" ? "" : "hidden"}>{run}</div>
      <div className={tab === "grade" ? "" : "hidden"}>{grade}</div>
    </div>
  );
}
