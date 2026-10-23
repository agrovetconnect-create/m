/**
 * Paper-template selection — pure Stage 4 domain logic (recognition plan §2.1
 * and §2.3): template-driven recognition needs the right template up front, and
 * an unknown or ambiguous template is ASKED, never guessed.
 */

import type { PaperTemplate } from "./models";

export type TemplateSelection =
  | { ok: true; template: PaperTemplate }
  | { ok: false; reason: "none_detected" | "multiple_candidates" | "unknown_id"; detail: string };

/**
 * Match a detected template id (fiducial / timing-mark pattern id) against the
 * configured templates of the matching paper type. Exactly one match → use it;
 * zero → ask; several (data bug) → ask with the candidates named.
 */
export function selectTemplate(
  templates: PaperTemplate[],
  detectedId: string | null,
  paperType: PaperTemplate["paperType"],
): TemplateSelection {
  const pool = templates.filter((t) => t.paperType === paperType);
  if (pool.length === 0) {
    return {
      ok: false,
      reason: "none_detected",
      detail: `no ${paperType} template configured`,
    };
  }
  if (detectedId === null || detectedId.trim() === "") {
    if (pool.length === 1) return { ok: true, template: pool[0] };
    return {
      ok: false,
      reason: "none_detected",
      detail: `${pool.length} configured templates and no fiducial id — teacher must choose`,
    };
  }
  const matches = pool.filter((t) => t.id === detectedId);
  if (matches.length === 1) return { ok: true, template: matches[0] };
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "unknown_id",
      detail: `detected "${detectedId}" matches no configured template`,
    };
  }
  return {
    ok: false,
    reason: "multiple_candidates",
    detail: `duplicate template id "${detectedId}" (${matches.length} entries)`,
  };
}

/**
 * Zones for recognition, resolved for a page: the template's zone map
 * (normalized 0–1 WITHIN the paper) is mapped into full-frame coordinates using
 * the detected paper bounds. A zone that does not fit inside the detected paper
 * is dropped — the engine reads only zones it can actually see, never invents
 * content. Returns null when no usable paper was detected.
 */
export function resolveZones(
  template: PaperTemplate,
  paperBounds: { x: number; y: number; w: number; h: number } | null,
): Record<string, { x: number; y: number; w: number; h: number }> | null {
  if (!paperBounds || paperBounds.w <= 0 || paperBounds.h <= 0) return null;
  const resolved: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [name, z] of Object.entries(template.zones)) {
    // Zone coords are paper-relative: reject anything outside the paper itself.
    if (z.x < -0.01 || z.y < -0.01 || z.x + z.w > 1.01 || z.y + z.h > 1.01) continue;
    resolved[name] = {
      x: paperBounds.x + z.x * paperBounds.w,
      y: paperBounds.y + z.y * paperBounds.h,
      w: z.w * paperBounds.w,
      h: z.h * paperBounds.h,
    };
  }
  return resolved;
}
