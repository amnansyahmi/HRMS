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
      ? chromium.args.filter((a) => a !== "--disable-web-security")
      : [],
    headless: true,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
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
    .getByRole("heading", { name: "Good to see you, Amnan." })
    .waitFor({ timeout: 30000 });
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/overview-desktop.png",
    fullPage: true,
  });
  const nav = async (label) => {
    await page
      .locator(".sidebar nav")
      .getByRole("button", {
        name: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      })
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
    await block
      .locator('input[type="file"]')
      .setInputFiles({
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
  await nav("HR policies");
  await page
    .getByRole("heading", { name: "HR policies", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Claim types", exact: true }).click();
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
  await page
    .locator("[data-sonner-toast]")
    .waitFor({ state: "hidden", timeout: 15000 });
  await page.screenshot({
    path: "docs/screenshots/assistant-desktop.png",
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
  await page
    .getByRole("heading", { name: "Good to see you, Amnan." })
    .waitFor();
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
