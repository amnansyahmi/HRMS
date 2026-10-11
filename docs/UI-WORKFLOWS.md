# HRMS daily workflow improvements

These changes keep Nonymauz People's teal identity and existing shadcn/Lucide components while making recurring HR work easier to scan and complete.

## Six implemented improvements

| Area               | Result                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard priority | Reviewers see pending approvals before workday and calendar panels. Employee home prioritizes the workday. Metrics use a compact, neutral strip. Secondary insights, digest and goals collapse behind a toggle on phones. Existing widget preferences remain available.                                                                                   |
| People directory   | Department, employment status and employment type filters; ascending/descending name and department sorting; removable filters; 10/25/50-row pagination; labeled employee cards on phones. Filters search visible names, titles, email and department names. Pagination covers workspace-loaded records; a notice appears when records are truncated.     |
| AI action previews | Labelled fields, formatted ringgit amounts and dates, policy/workplace names, affected record descriptions and readable full letter drafts replace raw JSON. Existing confirm/cancel authorization remains authoritative.                                                                                                                                 |
| AI streaming       | Opt-in NDJSON progress and incremental provider text. Protocol blocks are withheld while incomplete and removed from streaming text. Action cards arrive with the final saved result after server validation. Errors restore the draft; reader cancellation aborts provider work. Existing JSON clients and resume evidence validation remain compatible. |
| Forms and settings | Employee profile, employment, pay/leave and optional statutory sections; persistent save controls; linked field errors and a focusable error summary; persistent server error messages; discard/keep-editing dialog for record forms; unsaved navigation, browser back and unload protection.                                                             |
| Shared styles      | The original global cascade is divided into six ordered modules. New workflow styles share spacing, control height, radius and motion tokens and honor reduced motion.                                                                                                                                                                                    |

## Adapted from KretivOS HR

Reviewed `amnansyahmi/kretivos` at `814755ece21d6cbdfa31502c2b7b8bff303fbf93`, including the HR employee home, team hub, timesheet and shell.

KretivOS's mobile employee home makes attendance and personal requests particularly direct. This implementation adapts live elapsed work time, pending personal claim totals, recent requests, the next configured holiday, a published announcement preview and a reporting-team view. These use existing, authorized HRMS records and need no database migration. The reporting view is one level per team, avoiding recursive failure with circular or unavailable managers.

A task timesheet would need a separate data/workflow design and was not included. HRMS's existing leave balances, approval protections and attendance evidence flows remain the source of truth.

## Design skills

- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/67803eac81607188194aea9842a723b89326d90d/.claude/skills/ui-ux-pro-max/SKILL.md): interaction, accessibility, density and shadcn form guidance. Its generated search result proposed a marketing-page structure, so that output was rejected for this internal HR dashboard.
- [Frontend Design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): deliberate hierarchy, product-specific layout and consistent visual identity.
- Vercel React Best Practices and installed Next.js/AI SDK documentation informed component and streaming API checks.

## Verification

- Lint, TypeScript and production build.
- 174 Vitest tests, including directory privacy/filter/sort behavior, reporting cycles, scoped personal summaries, fragmented UTF-8 event parsing, interrupted streams, actual mocked provider SSE, API authentication, safe errors, cancellation and JSON compatibility.
- Playwright checks run against the real Next.js API and temporary PGlite data for desktop/mobile forms, directory controls, organization view, preferences, approvals, payroll, public applications, assessments, employee permissions, mobile navigation and unsaved settings protection. AI provider responses are mocked for deterministic streaming/UI verification. A focused `npm run verify:workflows` check also exercises the real AI route and SDK adapter against a local SSE provider, checks that no card is shown mid-stream, verifies that only confirmation changes the database, and checks saved conversation history.

Live ai-nonymauz-cloud streaming interoperability still needs a smoke test with the deployed backend and its configured credentials. The test provider exercises the OpenAI-compatible SSE contract; no production credentials were used.
