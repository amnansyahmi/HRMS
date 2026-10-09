import { z } from "zod";
export const skillsRubric = z
  .array(
    z.object({
      label: z
        .string()
        .trim()
        .min(2)
        .max(160)
        .refine(
          (v) =>
            !/\b(age|gender|religion|ethnicity|race|marital|pregnan|disabil|nationality|umur|jantina|agama|bangsa|perkahwinan|hamil)\w*\b/i.test(
              v,
            ),
          "Use job skills or experience, not personal characteristics",
        ),
      weight: z.coerce.number().finite().positive().max(100),
    }),
  )
  .max(10)
  .refine(
    (rows) =>
      new Set(rows.map((r) => r.label.toLowerCase())).size === rows.length,
    "Skills criteria must be unique",
  )
  .default([]);
/** A numeric rubric can only use configured job skills and verifiable quotations, never generated criteria. */
export function resumeEvidence(
  text: string,
  resume: string,
  criteria: z.infer<typeof skillsRubric>,
) {
  const match = text.match(/```resume-evidence\s*([\s\S]*?)```/);
  const cleaned = text.replace(/```resume-evidence\s*[\s\S]*?```/g, "").trim();
  if (!criteria.length) return cleaned;
  let parsed;
  try {
    parsed = z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(9),
            grade: z.number().int().min(0).max(3),
            quote: z.string().max(500),
            gap: z.string().max(600),
          })
          .strict(),
      )
      .length(criteria.length)
      .safeParse(JSON.parse(match?.[1] || "null"));
  } catch {
    parsed = null;
  }
  if (
    !parsed?.success ||
    new Set(parsed.data.map((r) => r.index)).size !== criteria.length ||
    parsed.data.some(
      (r) =>
        r.index >= criteria.length ||
        (r.grade > 0 && (!r.quote.trim() || !resume.includes(r.quote))) ||
        (r.grade === 0 && r.quote && !resume.includes(r.quote)),
    )
  )
    return "The AI did not provide a complete, verifiable skills rubric. No score was produced. Review the resume and criteria manually, or retry.";
  const rows = parsed.data.sort((a, b) => a.index - b.index),
    totalWeight = criteria.reduce((n, r) => n + r.weight, 0);
  const score = Math.round(
    (rows.reduce((n, r) => n + (r.grade / 3) * criteria[r.index].weight, 0) /
      totalWeight) *
      100,
  );
  const cell = (value: string) =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/([\[\]`*_<>])/g, "\\$1")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  return `## Skills evidence review\n\nDocumented evidence: **${score}/100** against the configured job rubric. This is a draft for HR verification; it is not a hiring decision, candidate ranking or prediction of performance.\n\n0 = no evidence, 1 = mentions the skill, 2 = describes using it, 3 = demonstrates a relevant outcome.\n\n| Job skill | Weight | Evidence grade | Resume quotation | Gap to discuss |\n| --- | ---: | ---: | --- | --- |\n${rows.map((r) => `| ${cell(criteria[r.index].label)} | ${criteria[r.index].weight} | ${r.grade}/3 | ${cell(r.quote || "No evidence supplied")} | ${cell(r.gap)} |`).join("\n")}\n\nCheck each quotation and grade against the original CV. Scanned or incomplete resumes may omit evidence.`;
}
