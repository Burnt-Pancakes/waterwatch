import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { MAX_TEXT_LENGTH, QUESTIONS } from "@/lib/focusGroup/config";
import type { FocusGroupQuestion } from "@/lib/focusGroup/config";
import { getDeviceId, isDone, markDone } from "@/lib/focusGroup/storage";

/** Strips HTML tags from free text before it is stored. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/** Returns the next unanswered question after the given index, honoring skips. */
function nextQuestion(currentId: string | null, skipped: ReadonlySet<string>): FocusGroupQuestion | null {
  const pool = QUESTIONS.filter(
    (q) => (q.repeatable || !isDone(q.id)) && !skipped.has(q.id) && q.id !== currentId,
  );
  return pool[0] ?? null;
}

interface FocusGroupPanelProps {
  onClose: () => void;
}

/**
 * One-question-at-a-time focus group panel.
 * Mobile: bottom sheet over a scrim with body scroll locked.
 * Desktop: 340px card anchored bottom-left, above the bar.
 */
export function FocusGroupPanel({ onClose }: FocusGroupPanelProps) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [question, setQuestion] = useState<FocusGroupQuestion | null>(() =>
    nextQuestion(null, new Set()),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const thankTimerRef = useRef<number | null>(null);

  const resetAnswer = useCallback(() => {
    setSelected([]);
    setText("");
    setError(null);
  }, []);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  // Focus management + Escape to close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
  }, [close]);

  // Lock body scroll while open (bottom sheet pattern).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Clear the thank-you timer on unmount.
  useEffect(() => {
    return () => {
      if (thankTimerRef.current !== null) {
        window.clearTimeout(thankTimerRef.current);
      }
    };
  }, []);

  const toggleOption = useCallback(
    (option: string) => {
      if (!question) return;
      setError(null);
      setSelected((prev) => {
        if (question.multi) {
          return prev.includes(option)
            ? prev.filter((o) => o !== option)
            : [...prev, option];
        }
        return prev.includes(option) ? [] : [option];
      });
    },
    [question],
  );

  const canSend = useMemo(() => {
    if (!question || sending) return false;
    return selected.length > 0 || text.trim().length > 0;
  }, [question, selected, text, sending]);

  const advance = useCallback(
    (fromId: string, newSkipped: ReadonlySet<string>) => {
      resetAnswer();
      setQuestion(nextQuestion(fromId, newSkipped));
    },
    [resetAnswer],
  );

  const handleSend = useCallback(async () => {
    if (!question || !canSend) return;
    setSending(true);
    setError(null);

    const deviceId = getDeviceId();
    if (!deviceId) {
      setSending(false);
      setError("That did not go through. Please try once more.");
      return;
    }
    const cleanText = stripHtml(text).trim().slice(0, MAX_TEXT_LENGTH);
    const responseText = cleanText.length > 0 ? cleanText : null;

    const rows =
      question.options && selected.length > 0
        ? selected.map((value) => ({
            device_id: deviceId,
            prompt_key: question.id,
            response_value: value,
            response_text: responseText,
            page_path: pathname,
          }))
        : [
            {
              device_id: deviceId,
              prompt_key: question.id,
              response_value: null as string | null,
              response_text: responseText,
              page_path: pathname,
            },
          ];

    const { error: insertError } = await supabase.from("preview_feedback").insert(rows);

    if (insertError) {
      setSending(false);
      setError("That did not go through. Please try once more.");
      return;
    }

    if (!question.repeatable) {
      markDone(question.id);
    }
    setSending(false);
    setThanked(true);
    const currentId = question.id;
    thankTimerRef.current = window.setTimeout(() => {
      setThanked(false);
      advance(currentId, skipped);
    }, 2000);
  }, [question, canSend, text, selected, pathname, skipped, advance]);

  const handleSkip = useCallback(() => {
    if (!question) return;
    const newSkipped = new Set(skipped).add(question.id);
    setSkipped(newSkipped);
    advance(question.id, newSkipped);
  }, [question, skipped, advance]);

  const showTextarea = Boolean(question?.freeTextLabel || question?.freeTextOnly);

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
        onClick={close}
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Focus group question"
        data-testid="focus-group-panel"
        className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-gray-200 bg-white p-4 pb-8 shadow-xl outline-none dark:border-gray-700 dark:bg-gray-900 sm:inset-x-auto sm:bottom-28 sm:left-4 sm:w-[340px] sm:rounded-xl sm:pb-4"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            {thanked
              ? "Thank you."
              : question
                ? question.text
                : "You've answered everything. Thank you."}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {thanked ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Your answer helps shape what gets built next.
          </p>
        ) : question ? (
          <>
            {question.options && (
              <div className="mt-3 flex flex-wrap gap-2">
                {question.options.map((option) => {
                  const active = selected.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleOption(option)}
                      className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-gray-900"
                          : "border-gray-200 bg-white text-foreground hover:border-teal-700/50 dark:border-gray-700 dark:bg-gray-900"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            {showTextarea && (
              <textarea
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white p-2 text-sm text-foreground placeholder:text-gray-400 focus:border-teal-700 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:placeholder:text-gray-500 dark:focus:border-teal-500"
                rows={3}
                maxLength={MAX_TEXT_LENGTH}
                placeholder={question.freeTextLabel ?? "Type your answer"}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
              />
            )}

            {error && (
              <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="min-h-11 flex-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:bg-teal-500 dark:text-gray-900"
              >
                {sending ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={handleSkip}
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-700/10 dark:text-teal-500 dark:hover:bg-teal-500/10"
              >
                Next question
              </button>
              <button
                type="button"
                onClick={close}
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Not now
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4">
            <button
              type="button"
              onClick={close}
              className="min-h-11 w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white dark:bg-teal-500 dark:text-gray-900"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </>
  );
}
