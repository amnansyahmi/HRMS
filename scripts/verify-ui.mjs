import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium as playwright } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { strict as assert } from "node:assert";
const directory = await mkdtemp(path.join(tmpdir(), "hrms-ui-"));
const port = Number(process.env.UI_TEST_PORT || 3400),
  base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "",
      APP_URL: base,
      DEMO_MODE: "true",
      HRMS_DATA_DIR: directory,
      NEXT_TELEMETRY_DISABLED: "1",
      UI_VERIFICATION: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  browser;
const errors = [];
server.stdout.on("data", (data) => {
  logs += data.toString();
});
server.stderr.on("data", (data) => {
  logs += data.toString();
});
try {
  console.log("Starting browser verification server.");
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(3000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null)
      throw new Error("Verification server exited: " + logs.slice(-3000));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Next.js did not start: " + logs.slice(-4000));
  console.log("Server ready. Checking the desktop workspace.");
  browser = await playwright.launch({
    executablePath: process.env.CHROMIUM_PATH || playwright.executablePath(),
    args: process.env.CHROMIUM_PATH
      ? [
          ...chromium.args.filter((a) => a !== "--disable-web-security"),
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
        ]
      : [
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
        ],
    headless: true,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        queueMicrotask(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [
              { isFinal: true, 0: { transcript: "Who is on leave today?" } },
            ],
          });
          this.onend?.();
        });
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    };
  });
  page.on("response", async (response) => {
    if (response.url().includes("/api/auth/demo") && !response.ok())
      console.error(
        "Demo login failed:",
        response.status(),
        await response.text(),
        "Origin:",
        response.request().headers().origin,
      );
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your workday, Amnan." })
    .waitFor({ timeout: 30000 });
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/overview-desktop.png",
    fullPage: true,
  });
  const nav = async (label) => {
    const groups = {
      People: ["People", "Employees"],
      "Employee files": ["People", "Files & lifecycle"],
      Leave: ["Time & leave", "Leave"],
      "Attendance & shifts": ["Time & leave", "Attendance & shifts"],
      "Team calendar": ["Time & leave", "Team calendar"],
      Claims: ["Pay & claims", "Claims"],
      "Payroll & payslips": ["Pay & claims", "Payroll & payslips"],
      Payments: ["Pay & claims", "Payments"],
      Recruitment: ["Hiring", "Recruitment"],
      Assessments: ["Hiring", "Assessments"],
      "Goals & evaluations": ["Performance", "Goals & evaluations"],
      "Review cycles": ["Performance", "Review cycles"],
      "Company handbook": ["Knowledge", "Company handbook"],
      "Meeting notes": ["Knowledge", "Meeting notes"],
    };
    if (label === "HR policies") {
      await page
        .locator(".sidebar")
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      await page.getByRole("tab", { name: "HR policies", exact: true }).click();
      return;
    }
    const [group, tab] = groups[label] || [label];
    await page
      .locator(".sidebar nav")
      .getByRole("button", {
        name: new RegExp("^" + group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
      .click();
    if (tab)
      await page
        .locator(".hub-tabs")
        .getByRole("button", { name: tab, exact: true })
        .click();
  };
  await nav("People");
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 8);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  await page.getByLabel("Full name", { exact: false }).fill("UI Test Person");
  await page
    .getByLabel("Work email", { exact: false })
    .fill("ui-person@demo.invalid");
  await page.getByLabel("Job title", { exact: false }).fill("Engineer");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await page.getByText("UI Test Person", { exact: true }).waitFor();
  await nav("Leave");
  await page
    .getByRole("button", { name: "Approve request from Aina Rahman" })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.locator("tbody").getByText("Approved", { exact: true }).waitFor();
  await nav("Claims");
  await page.getByRole("heading", { name: "Expense claims" }).waitFor();
  await nav("Attendance & shifts");
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await page.getByRole("button", { name: "Clock out", exact: true }).waitFor();
  await page.getByRole("button", { name: "Clock out", exact: true }).click();
  await page.getByRole("button", { name: "Clock in", exact: true }).waitFor();
  await page.getByRole("button", { name: "With photo", exact: true }).click();
  try {
    await page
      .getByRole("button", { name: "Capture and clock in", exact: true })
      .click();
  } catch (error) {
    console.error(
      "Camera diagnostics",
      await page.getByRole("dialog").innerText(),
      await page.locator("video").evaluate((v) => ({
        readyState: v.readyState,
        width: v.videoWidth,
        tracks: v.srcObject
          ?.getTracks()
          .map((t) => ({ state: t.readyState, enabled: t.enabled })),
      })),
    );
    throw error;
  }

  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Clock out", exact: true }).waitFor();
  await page.getByRole("button", { name: "With photo", exact: true }).click();
  await page
    .getByRole("button", { name: "Capture and clock out", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const cameraRecords = (
    await (await page.request.get(`${base}/api/workspace`)).json()
  ).records;
  assert(
    cameraRecords.some(
      (r) =>
        r.kind === "attendance" &&
        r.data.clockInEvidence?.photoId &&
        r.data.clockOutEvidence?.photoId,
    ),
    "Camera flow must persist both private photos",
  );
  await nav("Payroll & payslips");
  await page.getByRole("button", { name: "Prepare payroll" }).click();
  await page
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .waitFor();
  const workspaceResponse = await page.request.get(`${base}/api/workspace`),
    workspace = await workspaceResponse.json();
  const payslips = workspace.records.filter((r) => r.kind === "payroll");
  assert.equal(payslips.length, 9);
  // Exercise one real payroll form, then review the remaining drafts through the same API.
  await page
    .locator("tbody tr")
    .filter({ hasText: "Aina Rahman" })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page.getByLabel("EPF · employee (RM)").fill("440");
  await page
    .getByRole("checkbox", {
      name: "I have checked the earnings and all statutory deductions for this employee",
    })
    .check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const refreshed = await (
    await page.request.get(`${base}/api/workspace`)
  ).json();
  for (const draft of refreshed.records.filter(
    (r) => r.kind === "payroll" && !r.data.reviewed,
  )) {
    const response = await page.request.patch(
      `${base}/api/records/payroll/${draft.id}`,
      {
        headers: { Origin: base },
        data: { data: { reviewed: true }, updatedAt: draft.updated_at },
      },
    );
    assert(response.ok(), await response.text());
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Publish payslips", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish 9 payslips", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Payslip", exact: true })
    .first()
    .waitFor();
  const payslipHref = await page
      .getByRole("link", { name: "Payslip", exact: true })
      .first()
      .getAttribute("href"),
    payslipPage = await context.newPage();
  await payslipPage.goto(base + payslipHref);
  await payslipPage.getByText("Net pay", { exact: true }).waitFor();
  await payslipPage.close();
  await nav("Recruitment");
  await page
    .getByRole("heading", { name: "Recruitment", exact: true })
    .waitFor();
  await page.getByRole("tab", { name: /Candidates/ }).click();
  await page.getByText("Irfan Abdullah", { exact: true }).waitFor();
  await nav("Assessments");
  await page
    .getByRole("heading", { name: "Skills & work preferences" })
    .waitFor();
  await nav("Meeting notes");
  await page
    .getByRole("heading", { name: "Meeting notes", exact: true })
    .waitFor();
  await page
    .getByRole("checkbox", {
      name: "Complete Draft remaining onboarding chapters",
    })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Complete Draft remaining onboarding chapters",
      checked: true,
    })
    .waitFor();
  console.log("Checking onboarding review and the expanded HR screens.");
  await nav("Employee files");
  await page
    .getByLabel("Filter employee")
    .selectOption({ label: "UI Test Person" });
  await page
    .getByRole("button", { name: "Onboarding link", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Private onboarding link" })
    .waitFor();
  const onboardingUrl = await page
    .getByRole("dialog")
    .getByRole("textbox")
    .inputValue();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const onboardingPage = await context.newPage();
  await onboardingPage.goto(onboardingUrl);
  await onboardingPage.getByLabel("Phone", { exact: true }).fill("0123456789");
  await onboardingPage
    .getByLabel("Emergency contact", { exact: true })
    .fill("UI Contact");
  await onboardingPage
    .getByLabel("Emergency phone", { exact: true })
    .fill("0120000000");
  await onboardingPage
    .getByLabel(/Dependants/)
    .fill("Test Family | Spouse | 1995-01-01");
  for (const type of ["Identity", "Contract"]) {
    const block = onboardingPage
      .locator(".checklist .row-between")
      .filter({ hasText: type });
    await block.locator('input[type="file"]').setInputFiles({
      name: type + ".txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fabricated " + type + " for browser verification"),
    });
    await block.getByText(type + ".txt", { exact: true }).waitFor();
  }
  await onboardingPage
    .getByRole("button", { name: "Submit to HR", exact: true })
    .click();
  await onboardingPage
    .getByRole("heading", { name: "Ready for HR review" })
    .waitFor();
  await onboardingPage.close();
  await page.reload();
  await page
    .getByRole("heading", { name: "Employee files", exact: true })
    .waitFor();
  await page
    .locator(".onboarding-strip")
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await page
    .locator(".onboarding-strip")
    .getByText(/Approved/)
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/employee-files-desktop.png",
    fullPage: true,
  });
  console.log("Checking equipment, claim correction, and dated pay runs.");
  await page.getByRole("button", { name: "Equipment", exact: true }).click();
  await page
    .getByRole("button", { name: "Add equipment", exact: true })
    .click();
  await page
    .getByLabel("Employee", { exact: true })
    .selectOption({ label: "UI Test Person" });
  await page.getByLabel("Equipment", { exact: true }).fill("Browser laptop");
  await page.getByLabel("Serial number", { exact: false }).fill("BROWSER-001");
  await page.getByLabel("Issued on", { exact: false }).fill("2026-10-08");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  const assetCard = page
    .locator(".record-card")
    .filter({ hasText: "Browser laptop" });
  await assetCard.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Returned on", { exact: false }).fill("2026-10-09");
  await page.getByLabel("Condition", { exact: true }).selectOption("Returned");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const equipmentWorkspace = await (
    await page.request.get(`${base}/api/workspace`)
  ).json();
  assert.equal(
    equipmentWorkspace.records.find(
      (r) => r.kind === "asset" && r.data.serial === "BROWSER-001",
    ).data.returnedDate,
    "2026-10-09",
  );
  const aina = equipmentWorkspace.records.find(
    (r) => r.kind === "employee" && r.data.name === "Aina Rahman",
  );
  const correctionResponse = await page.request.post(
    `${base}/api/records/claim`,
    {
      headers: { Origin: base },
      data: {
        employeeId: aina.id,
        data: {
          category: "Travel",
          date: "2026-10-08",
          amount: 45,
          description: "Correction browser check",
        },
      },
    },
  );
  assert(correctionResponse.ok(), await correctionResponse.text());
  const correctionClaim = await correctionResponse.json();
  await nav("Claims");
  await page.reload();
  const correctionRow = page
    .locator("tbody tr")
    .filter({ hasText: "Correction browser check" });
  await correctionRow
    .getByRole("button", { name: "Return for correction", exact: true })
    .click();
  assert(
    await page
      .getByRole("button", { name: "Confirm", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("Review note").fill("Correct receipt amount");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await nav("Payroll & payslips");
  await page.getByLabel("Pay cycle", { exact: true }).selectOption("Weekly");
  await page.getByLabel("Run Starts").fill("2027-01-01");
  await page.getByLabel("Run Ends").fill("2027-01-07");
  await page.getByLabel("Run Pay date").fill("2027-01-08");
  await page
    .getByLabel("Payroll scope")
    .selectOption({ label: "UI Test Person" });
  await page
    .getByRole("button", { name: "Prepare payroll", exact: true })
    .click();
  await page.getByRole("button", { name: "Review", exact: true }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByLabel("Payroll period").inputValue(), "2027-01");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "I have checked the earnings and all statutory deductions for this employee",
    })
    .check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Publish payslips", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish 1 payslips", exact: true })
    .click();
  await page.getByRole("link", { name: "Payslip", exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/weekly-payroll-desktop.png",
    fullPage: true,
  });
  await page
    .locator(".sidebar-bottom")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshots/settings-desktop.png",
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({
    path: "docs/screenshots/settings-dark-desktop.png",
    fullPage: true,
  });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.getByRole("tab", { name: "AI connection", exact: true }).click();
  await page
    .getByRole("heading", { name: "HR specialist permissions" })
    .waitFor();
  assert.equal(
    await page
      .locator(".settings-panel")
      .filter({ hasText: "HR specialist permissions" })
      .locator(".record-card")
      .count(),
    7,
  );
  await page.getByRole("tab", { name: "People rules", exact: true }).click();
  await page
    .getByLabel("Minutes before shift for reminders (0 disables)")
    .fill("20");
  const statuses = page.getByLabel(
    "Employment statuses — name | access behaviour",
  );
  await statuses.fill((await statuses.inputValue()) + "\nConsultant|Active");
  const types = page.getByLabel("Employee types — one per line");
  await types.fill((await types.inputValue()) + "\nRetainer");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  assert.equal(
    (await (await page.request.get(`${base}/api/workspace`)).json()).company
      .settings.clockReminderMinutes,
    20,
  );
  const settingsWorkspace = await (
    await page.request.get(`${base}/api/workspace`)
  ).json();
  const ainaMember = settingsWorkspace.members.find(
    (member) => member.employee_id === aina.id,
  );
  for (const permissions of [["read"], []]) {
    const grant = await page.request.post(`${base}/api/auth/payroll-access`, {
      headers: { Origin: base },
      data: { userId: ainaMember.user_id, permissions },
    });
    assert(grant.ok(), await grant.text());
  }
  await nav("People");
  await page.getByRole("tab", { name: "Designations", exact: true }).click();
  await page
    .getByRole("button", { name: "Add designation", exact: true })
    .click();
  await page
    .getByLabel("Designation name", { exact: false })
    .fill("Browser specialist");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: /^Employees/ }).click();
  await page
    .getByRole("button", { name: "Edit UI Test Person", exact: true })
    .click();
  await page
    .getByLabel("Designation (optional)", { exact: true })
    .selectOption({ label: "Browser specialist" });
  await page
    .getByLabel("Employment status", { exact: true })
    .selectOption("Consultant");
  await page
    .getByLabel("Employment type", { exact: true })
    .selectOption("Retainer");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const configuredPerson = (
    await (await page.request.get(`${base}/api/workspace`)).json()
  ).records.find(
    (r) => r.kind === "employee" && r.data.name === "UI Test Person",
  );
  assert.equal(configuredPerson.data.title, "Browser specialist");
  assert.equal(configuredPerson.data.employmentStatus, "Consultant");
  assert.equal(configuredPerson.data.employmentType, "Retainer");
  await nav("HR policies");
  await page
    .getByRole("heading", { name: "HR policies", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Claim types", exact: true }).click();
  await page.getByRole("button", { name: "Holidays", exact: true }).click();
  await page
    .getByLabel("Holiday state", { exact: true })
    .selectOption("Sarawak");
  await page.getByRole("button", { name: "Preview 2026 holidays" }).click();
  const holidayDialog = page.getByRole("dialog");
  await holidayDialog
    .getByLabel("Holiday 1 title", { exact: true })
    .fill("Reviewed UI holiday");
  await holidayDialog
    .getByLabel("Holiday 1 date", { exact: true })
    .fill("2026-12-29");
  await holidayDialog.getByRole("checkbox").check();
  await holidayDialog
    .getByRole("button", { name: /^Import \d+ holidays$/ })
    .click();
  await holidayDialog.waitFor({ state: "hidden" });
  await page.getByText("Reviewed UI holiday", { exact: true }).waitFor();
  await nav("Review cycles");
  await page
    .getByRole("heading", { name: "Review cycles", exact: true })
    .waitFor();
  await nav("Goals & evaluations");
  await page
    .getByRole("heading", { name: "Goals & evaluations", exact: true })
    .waitFor();
  await page.getByLabel("Balanced scorecard").waitFor();
  await nav("Payments");
  await page.getByRole("heading", { name: "Payments", exact: true }).waitFor();
  await nav("Company handbook");
  await page.getByText("Leave and time off", { exact: true }).waitFor();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Ask People AI" })
    .click();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.getByRole("button", { name: "Voice input", exact: true }).click();
  await page
    .getByRole("button", { name: "Dictate message", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('textarea[aria-label="Message People AI"]')
        ?.value === "Who is on leave today?",
  );
  assert.equal(
    await page.locator(".user-message").count(),
    0,
    "Dictation must not send without review",
  );
  await page.getByLabel("Message People AI").fill("");
  await page.waitForFunction(
    () => !document.querySelector("[data-sonner-toast]"),
    undefined,
    { timeout: 20000 },
  );
  await page.screenshot({
    path: "docs/screenshots/assistant-desktop.png",
    fullPage: true,
  });
  console.log(
    "Checking minimal chat composer, history and specialist controls with a mocked AI response.",
  );
  const chatThread = "e790fd50-6f13-488a-b317-c8c020820711";
  const chatHistory = [];
  let chatRequests = 0;
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.ai = { configured: true, enabled: true, model: "ui-test-model" };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/ai", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: chatHistory });
    chatRequests++;
    const body = route.request().postDataJSON();
    if (chatRequests === 1)
      assert.equal(
        body.fileIds.length,
        1,
        "Chat must send the reviewed attachment ID",
      );
    const answer =
      "Here’s a clear starting point for your team.\n\n- Review pending leave requests.\n- Check dates against the team calendar.\n- Confirm any changes before saving.\n\n| Request | Status | Next step |\n| --- | --- | --- |\n| Annual leave | Pending | Review the dates |\n\nI can help you review a specific request next.";
    chatHistory.push(
      {
        role: "user",
        content: body.message,
        sources: [],
        thread_id: chatThread,
      },
      {
        role: "assistant",
        content: answer,
        sources: [],
        thread_id: chatThread,
      },
    );
    await route.fulfill({
      json: { threadId: chatThread, text: answer, sources: [], cards: [] },
    });
  });
  await page.goto(`${base}/?view=assistant`);
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page
    .getByRole("button", { name: "Who is on leave?", exact: true })
    .click();
  assert(
    (await page.getByLabel("Message People AI").inputValue()).includes("leave"),
  );
  await page.locator('.chat-composer input[type="file"]').setInputFiles({
    name: "chat-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Meeting follow-up: review requests."),
  });
  await page.getByRole("button", { name: /^chat-notes.txt/ }).click();
  assert.equal(
    await page.getByRole("dialog").locator("textarea").inputValue(),
    "Meeting follow-up: review requests.",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Message People AI").fill("Review my team requests");
  await page.getByLabel("Message People AI").press("Enter");
  assert.equal(chatRequests, 0, "Enter must add a newline without sending");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.locator(".ai-message table").waitFor();
  assert.equal(chatRequests, 1);
  await page.screenshot({
    path: "docs/screenshots/assistant-conversation-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Review my team requests/ })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  assert.equal(await page.locator(".chat-message").count(), 0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Review my team requests/ })
    .click();
  await page.locator(".ai-message table").waitFor();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .locator(".assistant-top")
    .getByRole("button", { name: "Chat options", exact: true })
    .click();
  await page
    .getByLabel("Assistant mode", { exact: true })
    .selectOption("resume");
  await page.keyboard.press("Escape");
  await page.getByLabel("Message People AI").fill("Review this resume");
  await page.getByLabel("Message People AI").press("Control+Enter");
  assert.equal(
    chatRequests,
    1,
    "Keyboard submit must respect required record selection",
  );
  await page
    .getByRole("button", { name: "Choose a record to review", exact: false })
    .click();
  await page
    .getByLabel("Record for AI review", { exact: true })
    .selectOption({ index: 1 });
  await page.keyboard.press("Escape");
  assert(
    !(await page
      .getByRole("button", { name: "Send message", exact: true })
      .isDisabled()),
  );
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.unroute("**/api/workspace");
  await page.unroute("**/api/ai");
  await page.goto(`${base}/?view=assistant`);
  console.log("Checking approval inbox and scoped desktop calendar.");
  const inboxRequest = await page.request.post(`${base}/api/records/time_off`, {
    headers: { Origin: base },
    data: {
      employeeId: aina.id,
      data: {
        date: "2027-02-02",
        start: "10:00",
        end: "11:00",
        reason: "Inbox time request browser check",
      },
    },
  });
  assert(inboxRequest.ok(), await inboxRequest.text());
  const inboxRecord = await inboxRequest.json();
  await nav("Approval inbox");
  await page.reload();
  await page
    .getByRole("heading", { name: "Approval inbox", exact: true })
    .waitFor();
  await page
    .getByLabel("Search approval inbox…")
    .fill("Inbox time request browser check");
  await page
    .locator(".approval-card")
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  await page.getByLabel("Decision", { exact: true }).selectOption("Approved");
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const inboxUpdated = (
    await (await page.request.get(`${base}/api/workspace`)).json()
  ).records.find((r) => r.id === inboxRecord.id);
  assert.equal(inboxUpdated.data.status, "Approved");
  await page.screenshot({
    path: "docs/screenshots/approvals-desktop.png",
    fullPage: true,
  });
  await nav("Team calendar");
  await page.getByLabel("Calendar month").fill("2027-02");
  await page.getByLabel("Calendar category").selectOption("time_off");
  await page.getByRole("button", { name: /^2027-02-02/ }).click();
  await page
    .locator(".calendar-grid")
    .getByText("Aina Rahman · Time off", { exact: true })
    .waitFor();
  const calendarResponse = await page.request.get(
    `${base}/api/export?type=calendar&start=2027-02-01&end=2027-02-28&scope=team&category=time_off`,
  );
  assert(calendarResponse.ok(), await calendarResponse.text());
  const calendarText = await calendarResponse.text();
  assert(calendarText.includes("DTSTART:20270202T020000Z"));
  assert(!calendarText.includes("Inbox time request browser check"));
  await page.screenshot({
    path: "docs/screenshots/calendar-desktop.png",
    fullPage: true,
  });
  console.log(
    "Desktop flows passed. Checking public applications and assessments.",
  );
  const careerPage = await context.newPage();
  await careerPage.goto(`${base}/careers/${workspace.company.slug}`);
  await careerPage
    .getByRole("button", { name: "Apply", exact: true })
    .first()
    .click();
  await careerPage.getByLabel("Full name").fill("Portal Test Candidate");
  await careerPage
    .getByLabel("Email", { exact: true })
    .fill("portal-candidate@demo.invalid");
  await careerPage
    .getByLabel("Experience / resume text")
    .fill(
      "I have three years of React and TypeScript experience, REST API integration and accessible HTML. I write automated tests.",
    );
  await careerPage.getByRole("checkbox").check();
  await careerPage.getByRole("button", { name: "Submit application" }).click();
  await careerPage
    .getByRole("heading", { name: "Thank you for applying." })
    .waitFor();
  await careerPage.close();
  const applied = await (
      await page.request.get(`${base}/api/workspace`)
    ).json(),
    candidate = applied.records.find(
      (r) => r.kind === "candidate" && r.data.name === "Portal Test Candidate",
    ),
    assessment = applied.records.find(
      (r) => r.kind === "assessment" && r.data.type === "Skills",
    );
  assert(candidate);
  const invite = await page.request.post(
    `${base}/api/actions/assessment-invite`,
    {
      headers: { Origin: base },
      data: { candidateId: candidate.id, assessmentId: assessment.id },
    },
  );
  assert(invite.ok());
  const invitation = await invite.json();
  const quiz = await context.newPage();
  await quiz.goto(invitation.url);
  await quiz.getByLabel("button", { exact: true }).check();
  await quiz.getByLabel("401", { exact: true }).check();
  await quiz.getByRole("button", { name: "Submit answers" }).click();
  await quiz.getByRole("heading", { name: "Answers submitted." }).waitFor();
  assert((await quiz.locator("body").textContent()).includes("100%"));
  await quiz.close();
  console.log("Public flows passed. Checking mobile and employee permissions.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/overview-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page overflows horizontally",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished));
  });
  await page.screenshot({ path: "docs/screenshots/navigation-mobile.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "People", exact: true })
    .click();
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile table escapes its scroll container",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ask People AI" })
    .click();
  await page
    .getByRole("heading", { name: "What can I help you with?" })
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/assistant-mobile.png",
    fullPage: true,
  });
  const composerBounds = await page.locator(".chat-composer").boundingBox();
  const navigationBounds = await page
    .locator(".mobile-bottom-nav")
    .boundingBox();
  assert(
    composerBounds &&
      navigationBounds &&
      composerBounds.y + composerBounds.height <= navigationBounds.y,
    "Phone navigation overlaps chat input",
  );
  await page
    .getByLabel("Message People AI")
    .fill("A longer message\n".repeat(18));
  assert(
    (await page.getByLabel("Message People AI").boundingBox()).height <= 162,
    "Growing phone composer exceeds its height limit",
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Phone chat overflows horizontally",
  );
  await page.getByLabel("Message People AI").fill("");
  await page
    .locator(".assistant-top")
    .getByRole("button", { name: "Chat options", exact: true })
    .click();
  const optionsBounds = await page
    .locator(".chat-options-popover")
    .boundingBox();
  assert(
    optionsBounds.x >= 0 && optionsBounds.x + optionsBounds.width <= 390,
    "Chat options escape the phone viewport",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 460,
    });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  assert(
    !(await page.locator(".mobile-bottom-nav").isVisible()),
    "Phone navigation should clear the keyboard",
  );
  const typingBounds = await page.locator(".chat-composer").boundingBox();
  assert(
    typingBounds.y + typingBounds.height <= 460,
    "Chat composer is covered by the keyboard",
  );
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  assert(
    await page.locator(".mobile-bottom-nav").isVisible(),
    "Phone navigation did not return after typing",
  );
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.ai = { configured: true, enabled: true, model: "ui-test-model" };
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/ai", async (route) =>
    route.fulfill({ json: chatHistory }),
  );
  await page.goto(`${base}/?view=assistant`);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Review my team requests/ })
    .click();
  await page.locator(".ai-message table").waitFor();
  await page
    .locator('[data-slot="dialog-content"]')
    .waitFor({ state: "detached" });
  await page.screenshot({
    path: "docs/screenshots/assistant-conversation-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 568 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Small phone chat overflows horizontally",
  );
  await page.waitForFunction(() => {
    const composer = document
      .querySelector(".chat-composer")
      ?.getBoundingClientRect();
    const nav = document
      .querySelector(".mobile-bottom-nav")
      ?.getBoundingClientRect();
    return composer && nav && composer.bottom <= nav.top;
  });
  const smallComposer = await page.locator(".chat-composer").boundingBox();
  const smallNav = await page.locator(".mobile-bottom-nav").boundingBox();
  assert(
    smallComposer.y + smallComposer.height <= smallNav.y,
    "Small phone navigation covers the chat composer",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute("**/api/workspace");
  await page.unroute("**/api/ai");
  for (const view of ["settings", "payroll"]) {
    await page.goto(`${base}/?view=${view}`);
    await page
      .getByRole("heading", {
        name: view === "settings" ? "Workspace settings" : "Payroll & payslips",
        exact: true,
      })
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Mobile ${view} overflows`,
    );
    await page.screenshot({
      path: `docs/screenshots/${view}-mobile.png`,
      fullPage: true,
    });
  }
  await page.request.post(`${base}/api/auth/demo`, {
    headers: { Origin: base },
    data: { role: "employee" },
  });
  await page.goto(`${base}/?view=payroll`);
  await page.getByRole("heading", { name: "Payroll & payslips" }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Payslip", exact: true }).count(),
    1,
  );
  const employeeView = await (
    await page.request.get(`${base}/api/workspace`)
  ).json();
  assert(!employeeView.records.some((r) => r.kind === "candidate"));
  assert(
    employeeView.records
      .filter(
        (r) => r.kind === "employee" && r.id !== employeeView.actor.employeeId,
      )
      .every((r) => r.data.salary === undefined),
  );
  await page.goto(`${base}/?view=claims`);
  await page
    .getByRole("button", { name: "Correct & resubmit", exact: true })
    .click();
  await page.getByLabel("Amount (RM)", { exact: false }).fill("35");
  await page
    .getByRole("button", { name: "Resubmit claim", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const corrected = (
    await (await page.request.get(`${base}/api/workspace`)).json()
  ).records.find((r) => r.id === correctionClaim.id);
  assert.equal(corrected.data.status, "Pending");
  assert.equal(corrected.data.amount, 35);
  assert.deepEqual(
    corrected.data.history.map((e) => e.action),
    ["Submitted", "Returned", "Resubmitted"],
  );
  await page.screenshot({
    path: "docs/screenshots/claims-mobile.png",
    fullPage: true,
  });
  console.log("Checking mobile contact updates and HR approval.");
  await page.goto(`${base}/?view=my-profile`);
  await page
    .getByRole("heading", { name: "My profile", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Request an update", exact: true })
    .click();
  await page.getByLabel("Phone", { exact: true }).fill("0135550199");
  await page
    .getByLabel("Reason for update", { exact: true })
    .fill("Updated contact browser check");
  await page.getByRole("button", { name: "Send to HR", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByText("HR is reviewing your latest request.", { exact: true })
    .waitFor();
  const profileWorkspace = await (
    await page.request.get(`${base}/api/workspace`)
  ).json();
  const profileRequest = profileWorkspace.records.find(
    (r) =>
      r.kind === "profile_change" &&
      r.data.reason === "Updated contact browser check",
  );
  assert.equal(profileRequest.data.status, "Pending");
  assert.notEqual(
    profileWorkspace.records.find(
      (r) => r.id === profileWorkspace.actor.employeeId,
    ).data.phone,
    "0135550199",
  );
  assert.equal((await page.request.get(`${base}/api/setup`)).status(), 403);
  await page.screenshot({
    path: "docs/screenshots/profile-mobile.png",
    fullPage: true,
  });
  await page.goto(`${base}/?view=calendar`);
  await page
    .getByRole("heading", { name: "Team calendar", exact: true })
    .waitFor();
  await page.getByLabel("Calendar month").fill("2027-02");
  await page.getByLabel("Calendar category").selectOption("time_off");
  await page.getByRole("button", { name: /^2027-02-02/ }).click();
  await page
    .locator(".calendar-agenda")
    .getByText("Aina Rahman · Time off", { exact: true })
    .waitFor();
  const privateCalendar = await page.request.get(
    `${base}/api/export?type=calendar&start=2027-02-01&end=2027-02-28&scope=team`,
  );
  assert(privateCalendar.ok());
  assert(!(await privateCalendar.text()).includes("UI Test Person"));
  await page.screenshot({
    path: "docs/screenshots/calendar-mobile.png",
    fullPage: true,
  });
  await page.request.post(`${base}/api/auth/demo`, {
    headers: { Origin: base },
    data: { role: "owner" },
  });
  await page.goto(`${base}/?view=approvals`);
  await page
    .getByRole("heading", { name: "Approval inbox", exact: true })
    .waitFor();
  await page
    .getByLabel("Search approval inbox…")
    .fill("Updated contact browser check");
  await page
    .locator(".approval-card")
    .getByRole("button", { name: "Review request", exact: true })
    .click();
  await page
    .locator(".profile-diff")
    .getByText("0135550199", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Confirm decision", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const approvedProfile = (
    await (await page.request.get(`${base}/api/workspace`)).json()
  ).records.find((r) => r.id === aina.id);
  assert.equal(approvedProfile.data.phone, "0135550199");
  await page.screenshot({
    path: "docs/screenshots/approvals-mobile.png",
    fullPage: true,
  });
  await page.goto(`${base}/?view=settings`);
  await page
    .getByLabel("Settings section", { exact: true })
    .selectOption("employees");
  await page.getByRole("heading", { name: "Employee configuration" }).waitFor();
  await page.setViewportSize({ width: 320, height: 568 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Small phone settings overflow",
  );
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.screenshot({
    path: "docs/screenshots/settings-dark-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Settings section", { exact: true })
    .selectOption("security");
  await page
    .getByRole("heading", { name: "Account security", exact: true })
    .waitFor();
  await page
    .getByLabel("Settings section", { exact: true })
    .selectOption("setup");
  await page
    .getByText("Database connection: responding.", { exact: false })
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/setup-mobile.png",
    fullPage: true,
  });
  console.log("Checking mobile Settings exit without saving.");
  let settingsWrites = 0;
  const countSettings = (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().includes("/api/workspace")
    )
      settingsWrites++;
  };
  page.on("request", countSettings);
  await page
    .getByRole("button", { name: "Back to workspace", exact: true })
    .click();
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Unsaved mobile edit");
  await page
    .getByRole("button", { name: "Back to workspace", exact: true })
    .click();
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  assert.notEqual(
    await page.getByLabel("Company name", { exact: true }).inputValue(),
    "Unsaved mobile edit",
  );
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Unsaved browser back");
  await page.goBack();
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  assert.equal(settingsWrites, 0, "Leaving Settings must not save");
  page.off("request", countSettings);
  for (const view of ["approvals", "calendar", "my-profile"]) {
    await page.goto(`${base}/?view=${view}`);
    await page
      .getByRole("heading", {
        name:
          view === "approvals"
            ? "Approval inbox"
            : view === "calendar"
              ? "Team calendar"
              : "My profile",
        exact: true,
      })
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Mobile ${view} overflows`,
    );
  }
  await page.request.post(`${base}/api/auth/demo`, {
    headers: { Origin: base },
    data: { role: "employee" },
  });
  await page.goto(`${base}/?view=my-profile`);
  await page
    .getByRole("heading", { name: "My profile", exact: true })
    .waitFor();
  await page
    .locator(".profile-panel")
    .getByText("0135550199", { exact: true })
    .waitFor();
  console.log("Checking the phone PWA and public-only offline cache.");
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 20000 },
  );
  const manifest = await (
    await page.request.get(`${base}/manifest.webmanifest`)
  ).json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 2);
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  assert(
    viewport.includes("maximum-scale=1") &&
      viewport.includes("user-scalable=no"),
  );
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const key of keys)
      for (const request of await (await caches.open(key)).keys())
        urls.push(new URL(request.url).pathname);
    return urls;
  });
  assert(cached.includes("/offline.html"));
  assert(
    cached.every((url) =>
      [
        "/offline.html",
        "/icon-192.png",
        "/icon-512.png",
        "/apple-touch-icon.png",
      ].includes(url),
    ),
    "Private data entered the offline cache",
  );
  await context.setOffline(true);
  await page
    .getByText("Offline. Reconnect before submitting.", { exact: true })
    .waitFor();
  const offlinePage = await context.newPage();
  await offlinePage.goto(base, { waitUntil: "domcontentloaded" });
  await offlinePage.getByRole("heading", { name: "You’re offline." }).waitFor();
  await offlinePage.close();
  await context.setOffline(false);
  const blocked = await page.request.get(`${base}/api/export?type=employees`);
  assert.equal(blocked.status(), 403);
  assert.equal(errors.length, 0, "Browser errors: " + errors.join("; "));
  await writeFile(
    "docs/screenshots/verification.json",
    JSON.stringify(
      {
        desktop: true,
        mobile: true,
        publicApplications: true,
        assessmentSubmission: true,
        payrollPublication: true,
        weeklyPayRun: true,
        equipmentReturn: true,
        returnedClaimResubmission: true,
        specialistControls: true,
        reviewedHolidayImport: true,
        dictationRequiresReview: true,
        approvalInbox: true,
        scopedCalendarDownload: true,
        profileChangeApproval: true,
        ownerSetupChecks: true,
        employeeIsolation: true,
        onboardingReview: true,
        extendedScreens: true,
        pwaPublicOfflineCache: true,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: desktop, mobile, application, assessment, payroll, employee permissions. No browser errors.",
  );
} catch (error) {
  console.error(error);
  console.error(logs.slice(-4500));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(directory, { recursive: true, force: true });
}
