import { EXPLAINER_SECTIONS, NO_AIR_OFFSET_NOTE } from "../content";

/**
 * Renders the ordered explainer sections from content.ts.
 * No props — content is static. Embed inside a modal, drawer, or expandable section.
 * The "what-to-do" section receives NO_AIR_OFFSET_NOTE as a callout box.
 */
export function WaterTempExplainer() {
  return (
    <div className="space-y-4 text-sm">
      {EXPLAINER_SECTIONS.map((section) => (
        <div key={section.id}>
          <h4 className="mb-1 font-semibold text-foreground dark:text-white">{section.heading}</h4>
          <p className="leading-relaxed text-muted-foreground">{section.body}</p>
          {section.id === "what-to-do" && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {NO_AIR_OFFSET_NOTE}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
