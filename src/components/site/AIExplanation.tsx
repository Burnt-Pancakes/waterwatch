import { useEffect, useState } from "react";
import { Fish, SwimArea, PersonStanding, Kayak } from "@/components/icons";
import { Button } from "@/components/ui/button";

type Activity = "swimming" | "kayaking" | "wading" | "fishing";

interface AIExplanationProps {
  siteName: string;
  status: string;
  eColiMpn: number | null;
  enterococciCce: number | null;
  waterBodyType: "freshwater" | "tidal_brackish";
  sampledAt: string | null;
  dataSource: string | null;
  recentRainInches?: number | null;
}

const ACTIVITIES: Array<{ id: Activity; label: string; icon: React.ReactNode }> = [
  { id: "swimming", label: "Swimming", icon: <SwimArea className="h-4 w-4" /> },
  { id: "kayaking", label: "Kayaking", icon: <Kayak className="h-4 w-4" /> },
  { id: "wading", label: "Wading", icon: <PersonStanding className="h-4 w-4" /> },
  { id: "fishing", label: "Fishing", icon: <Fish className="h-4 w-4" /> },
];

/**
 * Client-only component that streams an AI water quality explanation from
 * POST /api/explain. Requires a mount guard (useEffect) because it fetches
 * from a server route that must not run during SSR.
 */
export function AIExplanation(props: AIExplanationProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(false);
  const [responseText, setResponseText] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"rate_limit" | "other" | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const fetchExplanation = async (activity: Activity) => {
    setSelectedActivity(activity);
    setLoading(true);
    setResponseText(null);
    setErrorKind(null);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName: props.siteName,
          status: props.status,
          eColiMpn: props.eColiMpn,
          enterococciCce: props.enterococciCce,
          waterBodyType: props.waterBodyType,
          sampledAt: props.sampledAt,
          dataSource: props.dataSource,
          activity,
          recentRainInches: props.recentRainInches ?? null,
        }),
      });

      if (res.status === 429) {
        setErrorKind("rate_limit");
        return;
      }

      if (!res.ok) {
        setErrorKind("other");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setErrorKind("other");
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed: unknown = JSON.parse(payload);
            if (
              parsed !== null &&
              typeof parsed === "object" &&
              "text" in parsed &&
              typeof (parsed as { text: unknown }).text === "string"
            ) {
              accumulated += (parsed as { text: string }).text;
              setResponseText(accumulated);
            }
          } catch {
            // malformed SSE chunk — skip
          }
        }
      }
    } catch {
      setErrorKind("other");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-sm"
          onClick={() => setOpen(true)}
        >
          Ask WaterVoice AI
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
      <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
        What are you planning to do?
      </p>

      <div className="mb-3 flex gap-2">
        {ACTIVITIES.map(({ id, label, icon }) => (
          <button
            key={id}
            data-testid={`activity-${id}`}
            className={[
              "flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors",
              selectedActivity === id
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400",
            ].join(" ")}
            onClick={() => fetchExplanation(id)}
            disabled={loading}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div
          data-testid="loading-indicator"
          className="flex items-center gap-2 py-2 text-sm text-gray-500"
        >
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" />
          </span>
          <span>WaterVoice AI is thinking…</span>
        </div>
      )}

      {errorKind === "rate_limit" && (
        <p
          data-testid="error-rate-limit"
          className="py-2 text-sm text-amber-600 dark:text-amber-400"
        >
          You've reached the AI request limit. Try again in an hour.
        </p>
      )}

      {errorKind === "other" && (
        <p data-testid="error-other" className="py-2 text-sm text-red-600 dark:text-red-400">
          AI explanation unavailable. Please try again later.
        </p>
      )}

      {responseText && !loading && (
        <p
          data-testid="ai-response"
          className="py-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300"
        >
          {responseText}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        AI-generated advisory based on EPA 2012 RWQC guidelines. Not a regulatory determination.
        Consult your local health authority for official guidance.
      </p>
    </div>
  );
}
