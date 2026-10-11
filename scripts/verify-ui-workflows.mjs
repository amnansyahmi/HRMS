import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { chromium as playwright } from "@playwright/test";
import chromium from "@sparticuz/chromium";
const directory = await mkdtemp(path.join(tmpdir(), "hrms-workflows-"));
const port = Number(process.env.UI_TEST_PORT || 3400),
  base = `http://127.0.0.1:${port}`;
let finishStream,
  upstreamRequests = 0,
  server,
  browser,
  logs = "";
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const part of request) body += part;
  assert.equal(JSON.parse(body).stream, true);
  upstreamRequests++;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = (content) =>
    response.write(
      "data: " +
        JSON.stringify({
          id: "test-stream",
          model: "workflow-test",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        }) +
        "\n\n",
    );
  delta("I can prepare a reminder change.\n");
  delta(
    '```hr-action\n{"action":"configure","label":"Set clock reminder to 10 minutes","data":{"clockReminderMinutes":10}}',
  );
  await new Promise((resolve) => {
    finishStream = resolve;
  });
  delta("\n```\nReview the proposed change below.");
  response.end(
    "data: " +
      JSON.stringify({
        id: "test-stream",
        model: "workflow-test",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
try {
  server = spawn(
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
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: "",
        APP_URL: base,
        DEMO_MODE: "true",
        DEMO_AI_ENABLED: "true",
        HRMS_DATA_DIR: directory,
        NEXT_TELEMETRY_DISABLED: "1",
        UI_VERIFICATION: "true",
        AI_NONYMAUZ_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`,
        AI_NONYMAUZ_API_KEY: "local-test-fixture",
        AI_NONYMAUZ_MODEL: "workflow-test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (data) => {
      logs += data;
    });
  for (let n = 0; n < 90; n++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(3000) })).ok) break;
    } catch {}
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await playwright.launch({
    executablePath: process.env.CHROMIUM_PATH || playwright.executablePath(),
    args: process.env.CHROMIUM_PATH
      ? chromium.args.filter((a) => a !== "--disable-web-security")
      : [],
    headless: true,
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  const workspace = await (
    await page.request.get(base + "/api/workspace")
  ).json();
  const config = await page.request.patch(base + "/api/workspace", {
    headers: { Origin: base },
    data: {
      name: workspace.company.name,
      settings: {
        ...workspace.company.settings,
        aiEnabled: true,
        aiActionsEnabled: true,
        aiSpecialists: {
          ...workspace.company.settings.aiSpecialists,
          attendance: {
            ...workspace.company.settings.aiSpecialists.attendance,
            tools: [
              ...workspace.company.settings.aiSpecialists.attendance.tools,
              "configure",
            ],
          },
        },
      },
    },
  });
  assert(config.ok(), await config.text());
  console.log(
    "Checking streamed text through the real API, provider adapter and database.",
  );
  await page.goto(base + "/?view=assistant");
  await page
    .getByLabel("Message People AI")
    .fill("Set my clock reminder to 10 minutes");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator(".ai-message")
    .getByText("I can prepare a reminder change.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirm action", exact: true })
      .count(),
    0,
    "No action should appear before validation",
  );
  assert(
    !(await page.locator(".ai-message").first().innerText()).includes(
      "clockReminderMinutes",
    ),
  );
  finishStream();
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".readable-action-preview dd").innerText(),
    "10 minutes",
  );
  assert.equal(upstreamRequests, 1);
  await page.screenshot({
    path: "docs/screenshots/ai-action-preview-desktop.png",
  });
  const before = await (await page.request.get(base + "/api/workspace")).json();
  assert.equal(
    before.company.settings.clockReminderMinutes,
    workspace.company.settings.clockReminderMinutes,
    "Proposal must not change settings",
  );
  await page
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await page.getByText("Confirmed action completed", { exact: true }).waitFor();
  const after = await (await page.request.get(base + "/api/workspace")).json();
  assert.equal(after.company.settings.clockReminderMinutes, 10);
  const history = await (await page.request.get(base + "/api/ai")).json();
  assert(
    history.some(
      (m) =>
        m.role === "assistant" &&
        m.content.includes("Review the proposed change"),
    ),
    "Final conversation must be saved",
  );
  console.log("Checking directory paging, grouped forms and phone cards.");
  // Add records to the isolated test DB so pagination crosses a real page boundary.
  for (let n = 0; n < 5; n++) {
    const result = await page.request.post(base + "/api/records/employee", {
      headers: { Origin: base },
      data: {
        data: {
          name: `Paging Person ${n}`,
          email: `paging-${n}@demo.invalid`,
          title: "Designer",
          startDate: "2026-10-01",
          status: "Active",
          employmentStatus: "Active",
          employmentType: "Full-time",
        },
      },
    });
    assert(result.ok(), await result.text());
  }
  await page.goto(base + "/?view=people");
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  assert.equal(await page.locator(".people-table tbody tr").count(), 10);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  assert.equal(await page.locator(".people-table tbody tr").count(), 3);
  await page.getByLabel("Rows per page", { exact: true }).selectOption("25");
  assert.equal(await page.locator(".people-table tbody tr").count(), 13);
  await page.screenshot({
    path: "docs/screenshots/people-directory-desktop.png",
  });
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await page.locator(".form-error-summary").waitFor();
  await page.getByLabel("Full name", { exact: false }).fill("Draft person");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page
    .getByRole("heading", { name: "Discard unsaved changes?", exact: true })
    .waitFor({ state: "hidden" });
  await page
    .locator(".record-dialog")
    .evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({ path: "docs/screenshots/employee-form-desktop.png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/screenshots/people-directory-mobile.png",
  });
  assert.equal(
    await page
      .locator(".people-table tbody tr")
      .first()
      .evaluate((element) => getComputedStyle(element).display),
    "grid",
  );
  assert.equal(
    await page
      .locator(".people-table thead")
      .evaluate((element) => element.getBoundingClientRect().width),
    1,
  );
  await page.setViewportSize({ width: 320, height: 640 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.goto(base);
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  assert(
    !(await page.locator('[data-dashboard-widget="activity"]').isVisible()),
  );
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "docs/screenshots/dashboard-phone-viewport.png",
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "docs/screenshots/workflows-verification.json",
    JSON.stringify(
      {
        realApiStreaming: true,
        protocolWithheld: true,
        validatedPreview: true,
        explicitConfirmation: true,
        savedHistory: true,
        directoryPagination: true,
        formValidation: true,
        keepEdits: true,
        discardEdits: true,
        mobileCards: true,
        smallPhoneFits: true,
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: stream → validated action preview → explicit confirmation → database; directory paging, forms and phone layouts.",
  );
} catch (error) {
  console.error(logs.slice(-3500));
  throw error;
} finally {
  finishStream?.();
  await browser?.close();
  server?.kill("SIGTERM");
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
