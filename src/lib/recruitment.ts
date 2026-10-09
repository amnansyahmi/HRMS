import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./db";
import { rateLimit, hashToken, token, audit } from "./auth";
import { recordById, insertRecord, normalize } from "./hr";
import { schemas } from "./schema";
import { fail } from "./errors";
import { isStaff, type Actor, type Company, type HRRecord } from "./types";
import { profileTemplate, scoreProfile } from "./profile-templates";
import { queueEmail } from "./notifications";
import { extractFile } from "./files";
export async function careers(slug: string) {
  const company = (
    await db.query<Company>(
      "SELECT id,name,slug,settings FROM companies WHERE slug=$1",
      [slug],
    )
  ).rows[0];
  if (!company) fail("Company not found", 404);
  const jobs = (
    await db.query<HRRecord>(
      "SELECT * FROM hr_records WHERE company_id=$1 AND kind='job' AND data->>'status'='Published' ORDER BY created_at DESC",
      [company.id],
    )
  ).rows;
  return normalize({
    company: {
      name: company.name,
      slug: company.slug,
      intro: company.settings.careersIntro,
    },
    jobs: jobs.map((j) => ({ id: j.id, data: j.data })),
  });
}
export async function applyToJob(slug: string, input: unknown, file?: File) {
  if (file && !/\.(pdf|docx|txt)$/i.test(file.name))
    fail("Resumes must be PDF, DOCX or TXT");
  const attachment = file ? await extractFile(file) : null;
  const fileId = attachment ? randomUUID() : null;
  const data = schemas.candidate.parse({
    ...(input as object),
    ...(attachment ? { resume: attachment.text } : {}),
    stage: "Applied",
    notes: "",
    employeeId: null,
    interviewAt: null,
    stageHistory: [
      { stage: "Applied", at: new Date().toISOString(), by: "Applicant" },
    ],
    resumeFileId: fileId,
  });
  await rateLimit(`apply:${slug}:${data.email}`, 3, 3600);
  await rateLimit(`apply-workspace:${slug}`, 100, 3600);
  const company = (
    await db.query<{ id: string }>("SELECT id FROM companies WHERE slug=$1", [
      slug,
    ])
  ).rows[0];
  if (!company) fail("Company not found", 404);
  if (data.resume.length < 30)
    fail("Please include your experience or resume text");
  return transaction(async (tx) => {
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      company.id,
    ]);
    const job = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND id=$2 AND kind='job' AND data->>'status'='Published' FOR UPDATE",
        [company.id, data.jobId],
      )
    ).rows[0];
    if (!job) fail("This position is no longer accepting applications", 404);
    const questions = (job.data.screeningQuestions as string[]) || [];
    if (
      data.screeningAnswers.length !== questions.length ||
      questions.some(
        (q, i) =>
          data.screeningAnswers[i]?.question !== q ||
          !data.screeningAnswers[i].answer.trim(),
      )
    )
      fail("Answer every screening question from the current job listing");
    if (attachment) {
      const size = Number(
        (
          await tx.query<{ size: string }>(
            "SELECT coalesce(sum(size),0) AS size FROM files WHERE company_id=$1",
            [company.id],
          )
        ).rows[0].size,
      );
      if (
        size + attachment.size >
        Number(process.env.COMPANY_STORAGE_MAX_BYTES || 104857600)
      )
        fail(
          "This company cannot accept more attachments. Paste your resume text instead.",
          413,
        );
      await tx.query(
        "INSERT INTO files(id,company_id,uploaded_by,filename,mime,bytes,size,extracted_text) VALUES($1,$2,NULL,$3,$4,$5,$6,$7)",
        [
          fileId,
          company.id,
          attachment.filename,
          attachment.mime,
          attachment.bytes,
          attachment.size,
          attachment.text,
        ],
      );
    }
    const id = randomUUID();
    await tx.query(
      "INSERT INTO hr_records(id,company_id,kind,data) VALUES($1,$2,'candidate',$3)",
      [id, company.id, JSON.stringify(data)],
    );
    await tx.query(
      "INSERT INTO audit_log(id,company_id,action,entity_id) VALUES($1,$2,'Received career application',$3)",
      [randomUUID(), company.id, id],
    );
    return { submitted: true };
  });
}
export async function inviteAssessment(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can assign assessments", 403);
  const { assessmentId, candidateId, employeeId } = z
    .object({
      assessmentId: z.uuid(),
      candidateId: z.uuid().optional(),
      employeeId: z.uuid().optional(),
    })
    .refine(
      (v) => !!v.candidateId !== !!v.employeeId,
      "Choose a candidate or an employee",
    )
    .parse(input);
  const assessment = await recordById(actor, assessmentId, "assessment"),
    candidate = await recordById(
      actor,
      candidateId || employeeId!,
      candidateId ? "candidate" : "employee",
    );
  const plain = token();
  await transaction(async (tx) => {
    const data = schemas.assessment_result.parse({
      assessmentId,
      candidateId: candidateId || null,
      employeeId: employeeId || null,
      answers: [],
      score: 0,
      tokenHash: hashToken(plain),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      submittedAt: null,
      assessmentSnapshot: assessment.data,
    });
    await insertRecord(
      tx,
      actor,
      "assessment_result",
      data,
      employeeId || null,
    );
    await queueEmail(
      tx,
      actor.companyId,
      String(candidate.data.email),
      "Your assessment invitation",
      `Complete this assessment within seven days:\n${process.env.APP_URL || "http://localhost:3000"}/assessment/${plain}`,
    );
    await audit(tx, actor, "Assigned candidate assessment", candidate.id);
  });
  return {
    url: `${process.env.APP_URL || "http://localhost:3000"}/assessment/${plain}`,
  };
}
export async function publicAssessment(plain: string) {
  if (!/^[a-f0-9]{64}$/.test(plain)) fail("Assessment not found", 404);
  const record = (
    await db.query<HRRecord>(
      "SELECT * FROM hr_records WHERE kind='assessment_result' AND data->>'tokenHash'=$1 AND (data->>'expiresAt')::timestamptz>now()",
      [hashToken(plain)],
    )
  ).rows[0];
  if (!record || record.data.submittedAt)
    fail("Assessment expired or already submitted", 410);
  const snapshot = record.data.assessmentSnapshot as z.infer<
    typeof schemas.assessment
  >;
  return {
    title: snapshot.title,
    type: snapshot.type,
    instructions: snapshot.instructions,
    questions: snapshot.questions.map((q) => ({
      prompt: q.prompt,
      options: q.options,
    })),
  };
}
export async function submitAssessment(plain: string, input: unknown) {
  const { answers } = z
    .object({ answers: z.array(z.number().int().min(0).max(5)).max(30) })
    .parse(input);
  if (!/^[a-f0-9]{64}$/.test(plain)) fail("Assessment not found", 404);
  await rateLimit(`assessment:${plain}`, 5, 900);
  return transaction(async (tx) => {
    const record = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE kind='assessment_result' AND data->>'tokenHash'=$1 AND (data->>'expiresAt')::timestamptz>now() FOR UPDATE",
        [hashToken(plain)],
      )
    ).rows[0];
    if (!record || record.data.submittedAt)
      fail("Assessment expired or already submitted", 410);
    const assessment = record.data.assessmentSnapshot as z.infer<
      typeof schemas.assessment
    >;
    if (
      answers.length !== assessment.questions.length ||
      answers.some((a, i) => a >= assessment.questions[i].options.length)
    )
      fail("Answer each question");
    const score =
      assessment.type === "Skills"
        ? Math.round(
            (answers.filter(
              (a, i) => a === assessment.questions[i].correctIndex,
            ).length /
              answers.length) *
              100,
          )
        : 0;
    const data = {
      ...record.data,
      answers,
      profile: scoreProfile(assessment.type, answers),
      score,
      submittedAt: new Date().toISOString(),
    };
    await tx.query(
      "UPDATE hr_records SET data=$1,updated_at=now() WHERE id=$2 AND company_id=$3",
      [JSON.stringify(data), record.id, record.company_id],
    );
    await tx.query(
      "INSERT INTO audit_log(id,company_id,action,entity_id) VALUES($1,$2,'Submitted candidate assessment',$3)",
      [randomUUID(), record.company_id, record.id],
    );
    return {
      submitted: true,
      ...(assessment.type === "Skills" ? { score } : {}),
    };
  });
}

export async function createProfileTemplate(actor: Actor, input: unknown) {
  if (!isStaff(actor)) fail("Only HR can create questionnaires", 403);
  const { type } = z.object({ type: z.enum(["DISC", "DOPE"]) }).parse(input);
  const template = profileTemplate(type);
  return transaction(async (tx) => {
    const existing = (
      await tx.query<HRRecord>(
        "SELECT * FROM hr_records WHERE company_id=$1 AND kind='assessment' AND data->>'title'=$2",
        [actor.companyId, template.title],
      )
    ).rows[0];
    return (
      existing ||
      insertRecord(tx, actor, "assessment", schemas.assessment.parse(template))
    );
  });
}
