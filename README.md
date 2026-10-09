# Nonymauz People

An HR workspace in the existing HRMS repository, inspired by Kuasa HIRA's HR feature categories and connected to **ai-nonymauz-cloud**. Next.js, React, TypeScript, PostgreSQL and shadcn/ui power a quiet, ChatGPT-style interface.

![HR workspace](docs/screenshots/overview-desktop.png)

## Start locally

Use Node.js 22 or newer.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local`. Open **http://localhost:3000** and click **Log in** to enter an isolated workspace containing fabricated records. Demo owner, HR, manager and employee views are available. Temporary demo access is enabled by default, including production; set `DEMO_MODE=false` to show only the real-workspace credential flow. Existing real workspaces still use passwords and their configured MFA.

Development uses persistent PGlite in `.data/hrms` when `DATABASE_URL` is unset. Production requires PostgreSQL and never silently falls back to local disk. Each anonymous demo browser gets a different company. Demo email delivery is suppressed, and live AI is blocked unless `DEMO_AI_ENABLED=true` is explicitly configured.

## HR workflows

| Area                  | Behaviour                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HRIS                  | Malaysian employee fields, configurable employee status/type labels, reusable designations, dependants, education/employment history, private dated documents, equipment returns, onboarding links with required uploads and HR review, automatic employee invitations, atomic CSV imports, dated employment changes, printable letters and department announcements/read receipts.                   |
| Attendance and leave  | Phone clock-in/out, GPS geofences, recurring/rotating/overnight shifts, person/department assignment, state holiday records, configurable pre-shift reminders, custom entitlements, half-day/hourly leave, accrual/carry-forward, overtime/time-off, clock corrections and reviewed lateness reasons.                                                                                                 |
| Payroll               | Monthly/weekly/fortnightly/off-cycle/final-settlement runs, separate view/prepare/approve/payment access, company/department/person drafts, effective-date salary proration, approved unpaid leave and overtime at configured rates, claims in salary, allowances/bonus/commission, versioned Malaysian contributions and PCB, mandatory review, locked published payslips, vouchers and CSV exports. |
| Claims                | Custom types, annual/monthly/daily/per-trip/per-request limits, department eligibility, mileage rates, receipts and OCR suggestions, staged approval, return/correction/resubmission history, balances and year-to-date reports, reimbursement separately or with salary.                                                                                                                             |
| Recruitment           | Public careers, screening questions, private parsed resumes, AI resume review with configurable evidence rubrics, reusable job copies, dated stages/interviews, hired candidate → employee/checklist, and carried resume/assessment records.                                                                                                                                                          |
| Assessments and goals | Candidate/employee skills tests, original DISC/DOPE reflection questionnaires and team profiles, reusable review cycles/templates, weighted final evaluations, historical score comparisons, company/team/individual goal links and four-perspective scorecards.                                                                                                                                      |
| People AI             | Scoped HR, recruitment, resume, meeting and preference assistance; sourced records, private chat history, curated Employment Act references, seven HR specialists with per-tool permissions, deterministic scoped lookup facts, separately confirmed/cancellable request/stage/letter/clock/reminder actions, full letter previews, opt-in read-only CHRO briefs and browser dictation/read-aloud.    |
| Meetings              | Recording/audio upload, private chunked storage and playback, configured BM/English transcription, timestamped segments/flags, speaker labels/talk time, reviewed summaries/actions, selected-person sharing, employee linking and ICS import.                                                                                                                                                        |

The complete public feature target and unfinished completion gates are tracked in [HIRA-PARITY-CHECKLIST.md](docs/HIRA-PARITY-CHECKLIST.md). This release does not claim exact or fully live parity.

See [HIRA-COVERAGE.md](docs/HIRA-COVERAGE.md) for the comparison sources and exact configuration/limits. Reflection questionnaires are original conversation aids, not validated psychological tests or automated hiring decisions.

## Phones and PWA

The phone layout has bottom navigation, safe-area spacing, larger touch controls, scroll-contained tables and 16px form inputs. The manifest, icons and service worker support **Add to Home Screen** on iPhone and **Install app** on Android. Viewport and gesture controls request fixed scale; operating-system accessibility settings may override zoom restrictions.

Offline navigation displays a public reconnect screen. HR records, API responses, attachments and payslips are not put in Cache Storage. Submissions require an online connection. Recording needs HTTPS and microphone permission; keep the recording page open.

Ask People AI uses a minimal conversation layout with SVG controls, specialist and voice menus, a growing composer, and phone keyboard spacing. Enter adds a new line; Ctrl/⌘ + Enter sends. History remains private to the current user and workspace.

## Connect ai-nonymauz-cloud

```dotenv
AI_NONYMAUZ_BASE_URL=https://your-current-backend/v1
AI_NONYMAUZ_API_KEY=your-private-bearer-key
AI_NONYMAUZ_MODEL=an-alias-returned-by-your-backend
```

The server calls `/v1/chat/completions` using the AI SDK's OpenAI-compatible adapter, bearer authentication, `use_rag=false`, `use_tools=false`, a bounded timeout and no automatic paid-generation retries. The owner must enable AI in Settings. The seven HR specialists have separate read and action controls. Clock cards request fresh browser coordinates for geofenced sites. Reminder configuration cards are restricted to owners and reject changed settings. Disabling a tool invalidates pending cards for that tool. API keys remain server-only.

Records, resumes and transcripts are untrusted input. The model receives authorized context and may prepare a card; it cannot execute database writes. Confirmation rechecks actor, company, permissions, record version and expiry through the ordinary workflow. A card can be consumed only once. Replies show their supplied sources, which are a limited context snapshot. Recruitment AI uses explicit skills/experience; known candidate names and contacts are removed before resume review, but free text may still contain personal data. The configured backend/provider determines upstream data handling.

## Production and operations

1. Configure PostgreSQL `DATABASE_URL` and the exact canonical `APP_URL`. Origin checks protect mutations; previews also need their own correct origin.
2. Keep `DEMO_MODE=true` while testing the requested bypass; use `false` for credential-only entry. Configure AI if wanted.
3. Set SMTP variables and `EMAIL_FROM` for verification/reset/invitation delivery. `EMAIL_NOTIFICATIONS=true` also queues workflow/reminder email.
4. Generate a private `AUTH_ENCRYPTION_KEY` for encrypted TOTP MFA. MFA has replay protection and ten one-use recovery codes; enabling it revokes other sessions.
5. Schedule authenticated `GET /api/cron` calls with `CRON_SECRET`, for example every five minutes. This flushes the email outbox, creates deduplicated document/clock reminders, applies scheduled employment changes and expires stale jobs/tokens. Cron deployment/scheduling is external to this repository.
6. Run `npm run db:migrate`, `npm run build` and `npm start`, or use your Next.js hosting workflow. `GET /api/health` checks database availability.
7. Deploy the optional [media worker](services/media-worker/README.md) and set its URL/key for transcription and receipt OCR. Local OCR can instead use `OCR_ENABLED=true` and installed Tesseract.

Schema initialization is idempotent and also runs on first database use. PostgreSQL transactions lock company/workflow records. Passwords use salted scrypt; sessions use opaque hashed tokens in HttpOnly cookies, with Secure cookies in production. Company scope, roles, optimistic edits, persistent rate limits and private attachment checks are enforced server-side. Managers see their direct team; employees see their own workflows/payslips and a redacted directory. Meetings are private to their recorder/owner and selected shared employees.

Each normal upload/chunk is capped at approximately 2 MB; company storage defaults to 100 MB. Audio is uploaded in sequential private chunks, with at most three hours per combined meeting. Workspace records use keyset pagination; the client loads every page before displaying the refreshed workspace. Attachments currently live in PostgreSQL. Keep backups and monitor database/storage capacity.

## Payroll scope

HR must verify employee categories, eligibility, taxable wages, contribution wages, previous-employer figures and reliefs before automatic calculation. The checked-in source schedules and SHA-256 hashes are in `src/lib/data/malaysia-statutory.json`: EPF effective October 2025, EIS ceiling effective October 2024, SOCSO/SKBBK 2026 and PCB 2026. Automatic payroll is deliberately restricted to documented 2026 cases. Manual/unsupported profiles, other tax years and transitional cases need independently verified amounts.

The engine includes EPF Parts A/C/E/F, scheduled SOCSO/EIS, standard resident PCB, non-resident treatment and explicit selected special tax schemes. It handles additional remuneration and zakat offsets. Eligibility is an HR-reviewed profile choice, not inferred certification. Rest-day ordinary pay and any lateness adjustment remain HR-reviewed inputs; the payroll note includes attendance lateness for review. HR configures the applicable national/state holidays and employment terms.

**This software has not received LHDN payroll approval.** Validate against official employer cases before processing real wages. EA/CP22/CP22A downloads are clearly labelled preparation worksheets, not completed official forms or submissions. Payment vouchers record an actual bank transfer reference; the app does not initiate transfers or submit to statutory bodies. Use the current official employer forms and submission portals.

Short pay cycles prorate salary using the calendar-month divisor of each work date, including runs crossing month boundaries. Pay dates determine the payroll month. Overlapping base-salary runs are blocked; off-cycle runs start with zero base salary. Interim weekly/fortnightly deductions are entered from independently verified figures. Mark **Last payday of this month** when the final scheduled payday falls before calendar month-end. The same flag is editable on a draft. Use **Reconcile month-end deductions** on the final run to calculate the full month's contribution/tax total, subtract amounts already published and retain each run's own wages for year-to-date calculations. Resolve other drafts first. Negative adjustments require manual review. **Refresh inputs** reloads approved leave/OT/claims while keeping manual allowances and bonuses, then requires deductions and review again.

Owners configure payroll grants in Settings. Existing HR memberships retain their previous full payroll access until explicitly changed. Explicitly clearing all grants removes payroll/voucher access while retaining their HR role. Preparers can edit drafts; approvers publish them; payment users prepare and record vouchers. A non-owner cannot publish a run they prepared. Owners retain full access for small teams. Employees always retain their own published payslips.

Owners can add employee status labels and types. Status labels map to Active, Onboarding or Archived behaviour; archived labels revoke employee access through the normal archive workflow. In-use labels cannot be removed or remapped through global settings. Designations are reusable templates for the job title when selected; later designation edits do not silently rewrite employee history. Returned claims require a correction reason, retain the same ID and history, recheck policy/file permissions and restart approval when the claimant resubmits.

## Daily workspace tools

- **Approval inbox:** leave, claims, overtime, time off, clock corrections, lateness, goal progress and contact changes share a filterable inbox. “Needs my review” reflects the reporting manager/HR step and excludes self approval. Each decision shows the request, note and any attachment before confirmation, and rechecks the record version on the server.
- **My profile:** linked employees request changes to phone, address and emergency contacts. HR reviews the before/after fields; requests remain private to that employee and HR. Only one request can be pending. HR cannot approve their own change. Approval refuses to overwrite a field changed by HR after submission, while retaining unrelated HR edits. Banking, identity, salary and employment terms stay in the staff employee editor.
- **Team calendar:** desktop month view and phone agenda combine approved leave/time off, configured holidays and rotating shifts. Managers see their direct team, employees their own calendar, and HR the workspace. Pending events are optional in the screen and excluded from ICS downloads. Exports omit request reasons, medical leave types and attachments; they are static files, not calendar subscriptions or live synchronization. Export ranges are limited to 62 days. Conventional half-day times remain subject to the documented shift limits.
- **Notifications:** opening an update marks that individual notification as read; other unread updates remain in the inbox.
- **Deployment setup:** the owner’s Settings tab checks required configuration presence/format without displaying credentials. Database connectivity is checked independently. The status does not prove SMTP delivery, scheduler operation, backups or live AI/worker availability. Missing or invalid `APP_URL` produces a setup message at login. In Vercel, set `APP_URL` to the exact HTTPS site address (no page path), scope it to the relevant environment and redeploy. Preview deployments need their own matching address.

Annual preparation worksheets distinguish published months from published runs and include commissions, zakat and reimbursements. They retain their worksheet-only status and require employer review.

## Encrypted backup and restore

Set a separate 32-byte hexadecimal `BACKUP_ENCRYPTION_KEY`, then:

```bash
node --import tsx scripts/backup.mts backup .backups/hrms.nphr
# Point DATABASE_URL (or local HRMS_DATA_DIR) at a separate, empty restore target.
node --import tsx scripts/backup.mts restore .backups/hrms.nphr --empty-database-only
```

Backups encrypt the consistent database snapshot and private file bytes with AES-256-GCM. Restore refuses a populated target, restores record relationships and revokes sessions/reset tokens. Preserve the original `AUTH_ENCRYPTION_KEY` separately for restored MFA. Review the restored email outbox before restarting delivery. Keep encrypted backups off the application host; an external scheduler/storage policy is needed for recurring backups.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install --with-deps chromium
npm run verify:ui
```

Tests exercise isolated database workflows, tenant boundaries, employee invitations, staged approvals and limits, onboarding/files, effective salaries, payments, evaluation snapshots, AI confirmation, private audio callbacks, MFA/reset, statutory boundaries and encrypted backup restoration. Upstream AI is mocked; live AI, SMTP and speech models require configured credentials/services.

The browser runner starts an isolated development server with fabricated data and covers desktop/phone flows, public careers/assessments, payroll publication, employee isolation, onboarding review, equipment returns, corrected claim resubmission, dated weekly payroll, configurable employee labels/designations, specialist controls, approval inbox decisions, private calendar downloads, phone contact updates with HR review, owner setup diagnostics and public-only PWA offline caching. Set `CHROMIUM_PATH` to a compatible installed Chromium if needed. Screenshots and verification results are in `docs/screenshots/`.

Third-party shadcn/ui source retains its MIT licence in `THIRD_PARTY_NOTICES.md`.

## Reviewed imports and AI evidence

HR policies → Holidays offers a 2026 Malaysian state/territory preset with the published Cabinet source, an editable preview and a CSV template. HR confirms the applicable dates, supplementary gazettes and substitute holidays before an atomic import. Duplicate date/state/title entries are skipped; existing entries are never overwritten. The original schedule hash and applicability are stored in `src/lib/data/malaysia-holidays-2026.json`. Custom CSV dates support other years without fabricated presets.

Claim policies support five reservation periods. Per-trip requests require a stable trip reference; requests for the same employee, policy and reference share a limit across dates and months. Pending, approved and paid claims reserve the limit. The form displays an estimate and the server rechecks it under the company transaction lock.

Job editors accept up to ten job-skills rubric rows in `skill or experience | weight` format. Resume mode requests one grade and an exact quotation for every configured criterion; the server rejects incomplete or fabricated evidence and calculates the weighted score. Grades are draft evidence descriptions for HR review, not verified competencies or automatic hiring decisions. Without a rubric, resume review stays qualitative. Completed DISC/DOPE/work-preference questionnaires can be selected for discussion summaries.

AI letter cards show complete wording, title and date. Confirm saves exactly that wording as a draft; issuing stays a separate HR action. The assistant can prepare up to five independent cards; Confirm and Cancel affect only that card. Owners can enable the read-only CHRO brief in AI settings. Full Voice AI streaming and official statutory form generation remain open in the parity checklist.
