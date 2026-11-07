import { z } from "zod";
import { evaluate, reasonCodeSchema, RUBRIC_VERSION, signalsSchema, validateReason, type ReasonCode, type Signals } from "./rubric";

export const sealedAssessmentSchema = z
  .object({
    v: z.literal(1),
    roundId: z.string().regex(/^[1-9]\d*$/),
    campaignId: z.string().min(1),
    submissionId: z.string().min(1),
    rubric: z.literal(RUBRIC_VERSION),
    reviewer: z.string().min(1),
    signals: signalsSchema,
    reasonCode: reasonCodeSchema,
    note: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, ctx) => {
    const reason = validateReason(value.signals, value.reasonCode);
    if (!reason.ok) ctx.addIssue({ code: "custom", path: ["reasonCode"], message: reason.message });
  });

export type SealedAssessment = z.infer<typeof sealedAssessmentSchema>;

/** Fixed field order: these exact bytes are timelock-encrypted by the SDK. */
export function sealedAssessmentJson(value: SealedAssessment): string {
  const parsed = sealedAssessmentSchema.parse(value);
  return JSON.stringify({
    v: parsed.v,
    roundId: parsed.roundId,
    campaignId: parsed.campaignId,
    submissionId: parsed.submissionId,
    rubric: parsed.rubric,
    reviewer: parsed.reviewer,
    signals: parsed.signals,
    reasonCode: parsed.reasonCode,
    note: parsed.note,
  });
}

export function parseSealedAssessment(json: string): SealedAssessment {
  return sealedAssessmentSchema.parse(JSON.parse(json));
}

export function assessmentOutcome(value: Pick<SealedAssessment, "signals">): "PASS" | "FAIL" {
  return evaluate(value.signals).outcome;
}

export function assessmentsAgree(left: SealedAssessment, right: SealedAssessment): boolean {
  return assessmentOutcome(left) === assessmentOutcome(right);
}

export interface FinalAssessmentInput {
  signals: Signals;
  reasonCode: ReasonCode;
  note: string;
}
