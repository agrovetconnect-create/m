/**
 * OMR response classification and answer-key scoring — pure Stage 4 domain
 * logic (recognition plan §2). The CV/cloud engines detect bubbles; this module
 * turns measured fill ratios into explicit response states and, only when the
 * teacher configured an answer key, raw credited counts.
 *
 * Hard rules:
 *  - `multiple` and `ambiguous` responses are NEVER auto-scored — flagged only.
 *  - Questions without a configured key entry are excluded from scoring.
 *  - Output is a raw mathematical credited count; the module never grades or
 *    evaluates the student.
 */

export type OmrFillState = "filled" | "blank" | "multiple" | "ambiguous";

export type OmrResponseInput = {
  pageId: string;
  question: number;
  /** Fill ratio 0–1 per bubble, as measured by the engine. */
  fills: number[];
  /** How many selections the question allows (single-select unless configured). */
  selectable?: number;
};

export type OmrResponse = {
  question: number;
  selected: number[];
  state: OmrFillState;
  /** 0–1; the margin between the strongest fill and the classification threshold. */
  confidence: number;
};

/** Classification thresholds (fractions of a full fill). */
export const OMR_THRESHOLDS = {
  /** Below this the bubble counts as blank. */
  blank: 0.35,
  /** Above this the bubble counts as filled. */
  filled: 0.65,
  /** Filled-band widths inside (blank, filled) are ambiguous. */
  ambiguityBand: 0.2,
} as const;

/**
 * Classify one response from measured fill ratios. The top bubble wins; the
 * confidence is how far the top ratio sits from the decision boundary it was
 * classified against (0 at the boundary, 1 at a full fill / clean blank).
 */
export function classifyResponse(input: OmrResponseInput): OmrResponse {
  const { fills } = input;
  const selectable = Math.max(1, input.selectable ?? 1);
  let topIdx = -1;
  let top = 0;
  let filledCount = 0;
  fills.forEach((f, i) => {
    if (f > OMR_THRESHOLDS.filled) filledCount += 1;
    if (f > top) {
      top = f;
      topIdx = i;
    }
  });

  if (filledCount === 0) {
    const state: OmrFillState = top > OMR_THRESHOLDS.blank ? "ambiguous" : "blank";
    // blank: margin below the blank threshold. ambiguous: the position inside
    // the uncertainty band — ambiguous reads always route to review regardless.
    const confidence =
      state === "blank"
        ? Math.min(1, (OMR_THRESHOLDS.blank - top) / OMR_THRESHOLDS.blank)
        : Math.min(1, (top - OMR_THRESHOLDS.blank) / (OMR_THRESHOLDS.filled - OMR_THRESHOLDS.blank));
    return { question: input.question, selected: [], state, confidence };
  }
  if (filledCount > selectable) {
    const selected = fills
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f > OMR_THRESHOLDS.filled)
      .sort((a, b) => b.f - a.f)
      .map(({ i }) => i);
    const [first, second] = selected.map((i) => fills[i]);
    return {
      question: input.question,
      selected,
      state: "multiple",
      confidence: Math.min(1, Math.max(0, first - second)),
    };
  }
  const selected = fills
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f > OMR_THRESHOLDS.filled)
    .sort((a, b) => b.f - a.f)
    .map(({ i }) => i);
  return {
    question: input.question,
    selected,
    state: "filled",
    confidence: Math.min(1, top - OMR_THRESHOLDS.filled + 0.35),
  };
}

export function classifySheet(responses: OmrResponseInput[]): OmrResponse[] {
  return responses.map(classifyResponse);
}

// --- Scoring -----------------------------------------------------------------

export type AnswerKey = Record<number, number[]>;

export type OmrScore = {
  /** Raw credited count — nothing else. */
  credited: number;
  /** Questions with a configured key entry. */
  keyed: number;
  /** Questions excluded because the key has no entry for them. */
  unkeyed: number;
  /** Questions flagged for the teacher instead of being auto-scored. */
  flaggedQuestions: number[];
};

/**
 * Score classified responses against the teacher-configured key. Selection sets
 * must match the key's set exactly (single-select keys expect one bubble).
 * Unkeyed questions are excluded; multiple/ambiguous are flagged, never scored.
 */
export function scoreAgainstKey(
  responses: OmrResponse[],
  key: AnswerKey,
): OmrScore {
  let credited = 0;
  let keyed = 0;
  let unkeyed = 0;
  const flaggedQuestions: number[] = [];

  for (const r of responses) {
    const expected = key[r.question];
    if (!expected || expected.length === 0) {
      unkeyed += 1;
      continue;
    }
    keyed += 1;
    if (r.state === "multiple" || r.state === "ambiguous") {
      flaggedQuestions.push(r.question);
      continue;
    }
    if (r.state === "filled" && expected.length === r.selected.length) {
      const want = [...expected].sort().join(",");
      const got = [...r.selected].sort().join(",");
      if (want === got) credited += 1;
    }
  }

  return { credited, keyed, unkeyed, flaggedQuestions };
}
