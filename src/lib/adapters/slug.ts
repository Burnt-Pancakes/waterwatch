/** Slugify a free-text POI name into a URL-safe identifier. */
export function slugify(name: string, fallback: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || fallback).slice(0, 80);
}
