import { useEffect, useState } from "react";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { MapHome, Rivers, Plan, Tides } from "@/components/icons";
import type { LucideProps } from "@/components/icons";
import type { ComponentType } from "react";

type Tab = {
  label: string;
  to: string;
  icon: ComponentType<LucideProps>;
  requiresAuth: boolean;
  testId: string;
};

const TABS: Tab[] = [
  { label: "Map", to: "/", icon: MapHome, requiresAuth: false, testId: "tab-map" },
  { label: "Rivers", to: "/rivers", icon: Rivers, requiresAuth: false, testId: "tab-rivers" },
  { label: "Plan", to: "/plan", icon: Plan, requiresAuth: false, testId: "tab-plan" },
  { label: "Tides", to: "/tides", icon: Tides, requiresAuth: false, testId: "tab-tides" },
];

export function BottomTabBar() {
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleTabPress = (tab: Tab) => {
    void navigate({ to: tab.to });
  };

  return (
    <nav
      aria-label="Main navigation"
      data-testid="bottom-tab-bar"
      className="fixed bottom-0 left-0 right-0 z-50 flex h-16 border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.to === "/" ? currentPath === "/" : currentPath.startsWith(tab.to);

        return (
          <button
            key={tab.to}
            type="button"
            data-testid={tab.testId}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => handleTabPress(tab)}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors"
          >
            {/* Active indicator bar */}
            {isActive && (
              <span className="absolute inset-x-0 top-0 h-0.5 rounded-b bg-teal-700 dark:bg-teal-500" />
            )}

            <span className="relative">
              <Icon
                size={22}
                className={
                  isActive ? "text-teal-700 dark:text-teal-500" : "text-gray-500 dark:text-gray-400"
                }
              />
            </span>

            <span
              className={`text-[10px] font-medium ${
                isActive ? "text-teal-700 dark:text-teal-500" : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
