import type { Analysis } from "../api/types";

/** Not önerisi ağırlıkları: ödevin istenen şeyi yapması (kapsam) kod kalitesinden önemli. */
export const COVERAGE_WEIGHT = 0.7;
export const CLEAN_WEIGHT = 0.3;
/** Bu benzerliğin üstünde öneriyle birlikte intihal uyarısı gösterilir (nota yansıtılmaz). */
export const PLAGIARISM_WARN = 70;

export interface GradeHint {
  coverage: number | null;
  cleanCode: number | null;
  similarity: number | null;
  suggested: number | null;
}

function latest(analyses: Analysis[], type: Analysis["analysis_type"]): Analysis | undefined {
  return analyses
    .filter((a) => a.analysis_type === type)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Teslimin son AI analizlerinden akademisyen için not referansı üretir. */
export function gradeHint(analyses: Analysis[]): GradeHint {
  const coverage = num(latest(analyses, "requirement_check")?.summary_json?.coverage);
  const cleanCode = num(latest(analyses, "clean_code")?.summary_json?.score);
  const similarity = num(latest(analyses, "plagiarism")?.summary_json?.top_similarity);
  let suggested: number | null = null;
  if (coverage != null && cleanCode != null) {
    suggested = Math.round(COVERAGE_WEIGHT * coverage + CLEAN_WEIGHT * cleanCode);
  } else if (coverage != null) {
    suggested = Math.round(coverage);
  } else if (cleanCode != null) {
    suggested = Math.round(cleanCode);
  }
  return { coverage, cleanCode, similarity, suggested };
}
