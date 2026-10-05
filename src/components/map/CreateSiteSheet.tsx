import { useRef, useState } from "react";
import { X } from "@/components/icons";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createUserSite } from "@/lib/userSites.functions";
import { cn } from "@/lib/utils";

type Props = {
  lngLat: [number, number];
  onClose: () => void;
  onCreated: (id: string, lngLat: [number, number]) => void;
};

export function CreateSiteSheet({ lngLat, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const doCreate = useServerFn(createUserSite);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const site = await doCreate({
        data: {
          name: trimmed,
          description: description.trim() || null,
          lat: lngLat[1],
          lng: lngLat[0],
        },
      });
      toast.success(`"${trimmed}" added to your spots`);
      onCreated((site as { id: string }).id, lngLat);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save spot");
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="create-site-sheet"
      className={cn(
        "pointer-events-auto fixed z-20 bg-card text-card-foreground shadow-2xl dark:bg-gray-900",
        "left-4 right-4 rounded-2xl border border-border dark:border-gray-700",
        "bottom-[calc(64px+env(safe-area-inset-bottom)+12px+36px+8px+var(--focus-group-bar-height,0px))]",
        "md:right-auto md:w-[420px]",
      )}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold dark:text-white">Name this spot</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="create-site-name" className="text-xs font-medium text-muted-foreground">
              Name{" "}
              <span aria-hidden className="text-destructive">
                *
              </span>
            </label>
            <input
              id="create-site-name"
              ref={nameRef}
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              maxLength={120}
              placeholder="e.g. Hains Point kayak launch"
              className={cn(
                "rounded-md border border-border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground/60",
                "focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30",
                "dark:bg-gray-800 dark:text-white",
              )}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="create-site-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              id="create-site-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Good parking, slippery ramp…"
              className={cn(
                "resize-none rounded-md border border-border bg-background px-3 py-2 text-sm",
                "placeholder:text-muted-foreground/60",
                "focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30",
                "dark:bg-gray-800 dark:text-white",
              )}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted dark:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium text-primary-foreground",
              "bg-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {saving ? "Saving…" : "Save spot"}
          </button>
        </div>
      </div>
    </div>
  );
}
