import { useEffect, useState } from "react";
import { Bell } from "@/components/icons";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getAlertConfig, upsertAlertConfig, deleteAlertConfig } from "@/lib/alerts.functions";
import { type AlertTrigger, TRIGGER_LABELS, WEATHER_ADVISORY_TRIGGER } from "@/lib/alertTriggers";

interface AlertConfigModalProps {
  siteId: string;
  siteName: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save/remove with the new "has alert" state. */
  onChanged?: (active: boolean) => void;
}

const TRIGGER_OPTIONS: Array<{ key: AlertTrigger; label: string }> = [
  { key: "caution", label: TRIGGER_LABELS.caution },
  { key: "unsafe", label: TRIGGER_LABELS.unsafe },
  { key: "pass", label: TRIGGER_LABELS.pass },
  { key: WEATHER_ADVISORY_TRIGGER, label: TRIGGER_LABELS.weather_advisory },
];

const DEFAULT_TRIGGER_ON: AlertTrigger[] = ["caution", "unsafe"];

export function AlertConfigModal({
  siteId,
  siteName,
  open,
  onClose,
  onChanged,
}: AlertConfigModalProps) {
  const fetchConfig = useServerFn(getAlertConfig);
  const saveConfig = useServerFn(upsertAlertConfig);
  const removeConfig = useServerFn(deleteAlertConfig);

  const [triggerOn, setTriggerOn] = useState<AlertTrigger[]>(DEFAULT_TRIGGER_ON);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    void fetchConfig({ data: { siteId } }).then((config) => {
      if (config) {
        setTriggerOn(config.trigger_on as AlertTrigger[]);
      } else {
        setTriggerOn(DEFAULT_TRIGGER_ON);
      }
      setLoaded(true);
    });
  }, [open, siteId, fetchConfig]);

  const toggle = (key: AlertTrigger) => {
    setTriggerOn((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveConfig({ data: { siteId, triggerOn } });
      toast.success("Alert saved");
      onChanged?.(true);
      onClose();
    } catch {
      toast.error("Could not save alert");
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    setSaving(true);
    try {
      await removeConfig({ data: { siteId } });
      toast.success("Alert removed");
      onChanged?.(false);
      onClose();
    } catch {
      toast.error("Could not remove alert");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl p-5">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Bell size={16} aria-hidden />
            </span>
            <span className="min-w-0 truncate">Alert settings</span>
          </DialogTitle>
          <p className="truncate text-sm text-muted-foreground">{siteName}</p>
        </DialogHeader>

        <div className="space-y-2 py-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notify me when
          </p>
          {!loaded ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : (
            TRIGGER_OPTIONS.map(({ key, label }) => {
              const checked = triggerOn.includes(key);
              return (
                <Label
                  key={key}
                  htmlFor={`trigger-${key}`}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-normal transition-colors",
                    checked
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <Checkbox
                    id={`trigger-${key}`}
                    checked={checked}
                    onCheckedChange={() => toggle(key)}
                    data-testid={`trigger-${key}`}
                  />
                  <span className="min-w-0">{label}</span>
                </Label>
              );
            })
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            onClick={onRemove}
            disabled={saving || !loaded}
            data-testid="remove-alert-btn"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
          >
            Remove alerts
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || !loaded || triggerOn.length === 0}
            data-testid="save-alert-btn"
            className="w-full sm:w-auto"
          >
            {saving ? "Saving…" : "Save alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AlertBellProps {
  siteId: string;
  siteName: string;
}

export function AlertBell({ siteId, siteName }: AlertBellProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Configure alerts for ${siteName}`}
        data-testid="alert-bell"
        onClick={() => setOpen(true)}
        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell size={18} />
      </button>
      {open && (
        <AlertConfigModal
          siteId={siteId}
          siteName={siteName}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
