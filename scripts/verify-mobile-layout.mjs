import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium as playwright, webkit } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { strict as assert } from "node:assert";
const directory = await mkdtemp(path.join(tmpdir(), "hrms-mobile-layout-"));
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
const engine = process.env.BROWSER_ENGINE === "webkit" ? "WebKit" : "Chromium";
const errors = [];
server.stdout.on("data", (data) => {
  logs += data.toString();
});
server.stderr.on("data", (data) => {
  logs += data.toString();
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(3000) })).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, logs);
  browser =
    engine === "WebKit"
      ? await webkit.launch({
          executablePath: process.env.WEBKIT_PATH,
          headless: true,
        })
      : await playwright.launch({
          executablePath:
            process.env.CHROMIUM_PATH || playwright.executablePath(),
          args: process.env.CHROMIUM_PATH
            ? chromium.args.filter((a) => a !== "--disable-web-security")
            : [],
          headless: true,
        });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Your workday, Amnan." }).waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  const fits = async () => {
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Page overflows horizontally",
    );
  };
  const checkFields = async () => {
    const problems = await page
      .locator(".record-dialog .form-field")
      .evaluateAll((fields) =>
        fields.flatMap((field) => {
          if (!field.getClientRects().length) return [];
          const box = field.getBoundingClientRect();
          return [
            ...field.querySelectorAll(
              "input:not([type=checkbox]),select,textarea",
            ),
          ].flatMap((input) => {
            if (!input.getClientRects().length) return [];
            const b = input.getBoundingClientRect();
            return b.width > box.width + 1 ||
              b.left < box.left - 1 ||
              b.right > box.right + 1
              ? [input.id || input.type]
              : [];
          });
        }),
      );
    assert.deepEqual(
      problems,
      [],
      "Fields must stay within their own grid cells",
    );
    assert(
      await page
        .locator(".record-dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      "Dialog overflows horizontally",
    );
  };
  const touchSwipe = async (x, y, dx, dy) => {
    if (engine === "WebKit") {
      await page
        .locator(".record-dialog form > div")
        .first()
        .evaluate((el, distance) => el.scrollBy(-distance.dx, -distance.dy), {
          dx,
          dy,
        });
      await page.waitForTimeout(200);
      return;
    }
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let n = 1; n <= 12; n++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * n) / 12, y: y + (dy * n) / 12 }],
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(200);
    await session.detach();
  };
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [view, button] of [
      ["claims", "Submit claim"],
      ["work-requests", "Add overtime"],
      ["leave", "Request leave"],
    ]) {
      await page.goto(base + "/?view=" + view);
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.locator(".record-dialog");
      await dialog.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector(".record-dialog")?.getBoundingClientRect()
            .width === innerWidth,
      );
      await fits();
      await checkFields();
      const box = await dialog.boundingBox();
      assert.equal(box.x, 0);
      assert.equal(box.y, 0);
      assert.equal(box.width, width);
      const scrollBefore = await page.evaluate(() => ({
        x: scrollX,
        y: scrollY,
      }));
      const body = dialog.locator("form > div").first();
      const initialScroll = await body.evaluate((el) => el.scrollTop);
      await touchSwipe(width / 2, 380, -160, 0);
      assert.equal(
        await body.evaluate((el) => el.scrollLeft),
        0,
        "Horizontal swipe must not move form",
      );
      await touchSwipe(width / 2, 600, 0, -500);
      const afterScroll = await body.evaluate((el) => el.scrollTop);
      if (view === "claims") {
        assert(afterScroll > initialScroll, "Long form must scroll vertically");
      }
      assert.deepEqual(
        await page.evaluate(() => ({ x: scrollX, y: scrollY })),
        scrollBefore,
        "Background must stay locked",
      );
      const footer = await dialog.locator(".record-savebar").boundingBox();
      assert(footer.y + footer.height <= 844 + 1, "Footer must stay on screen");
      await body.evaluate((el) => el.scrollTo(0, 0));
      if (width === 390) {
        await page.locator(":focus").evaluate((el) => el.blur());
        await page.screenshot({
          path: `docs/screenshots/${view}-form-phone.png`,
        });
      }
      // Invalid submission keeps the form open and offers linked error feedback.
      if (view === "claims" && width === 390) {
        await dialog
          .getByRole("button", { name: "Submit request", exact: true })
          .click();
        await page.locator(".form-error-summary").waitFor();
        await page
          .getByLabel("Business purpose", { exact: false })
          .fill("Phone layout check");
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Keep editing", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Discard unsaved changes?" })
          .waitFor({ state: "hidden" });
        assert.equal(
          await page
            .getByLabel("Business purpose", { exact: false })
            .inputValue(),
          "Phone layout check",
        );
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Discard changes", exact: true })
          .click();
      } else
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page.locator("body").getAttribute("data-scroll-locked"),
        null,
      );
    }
    for (const view of ["leave", "calendar"]) {
      await page.goto(base + "/?view=" + view);
      await page.getByLabel("Calendar month").waitFor();
      await page.getByLabel("Calendar month").fill("2026-10");
      await page.getByRole("button", { name: /^2026-10-16/ }).click();
      assert.equal(
        await page
          .getByRole("button", { name: /^2026-10-16/ })
          .getAttribute("aria-pressed"),
        "true",
      );
      await page
        .getByRole("button", { name: "Next month", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Calendar month").inputValue(),
        "2026-11",
      );
      await page
        .getByRole("button", { name: "Previous month", exact: true })
        .click();
      await fits();
      assert.equal(await page.locator(".calendar-agenda.panel").count(), 0);
      assert.equal(await page.locator(".leave-calendar.panel").count(), 0);
      if (width === 390) {
        await page.evaluate(() => {
          document.activeElement?.blur();
          scrollTo(0, 0);
        });
        await page.screenshot({
          path: `docs/screenshots/${view}-app-phone.png`,
        });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/?view=claims");
  await page.getByRole("button", { name: "Submit claim", exact: true }).click();
  await checkFields();
  const desktop = await page.locator(".record-dialog").boundingBox();
  assert(
    desktop.width <= 650 && desktop.x > 0,
    "Desktop dialog remains centered",
  );
  await page.screenshot({
    path: "docs/screenshots/claim-form-desktop-layout.png",
  });
  assert.deepEqual(errors, []);
  await writeFile(
    `docs/screenshots/mobile-layout-${engine.toLowerCase()}.json`,
    JSON.stringify(
      {
        viewports: [320, 390, 430],
        forms: ["claim", "overtime", "leave"],
        noFieldOverlap: true,
        noHorizontalPan: engine === "Chromium" ? true : null,
        noHorizontalOverflow: true,
        backgroundScrollLocked: engine === "Chromium" ? true : null,
        verticalFormScroll: true,
        visibleFooter: true,
        keepAndDiscardEdits: true,
        calendarNavigation: true,
        noNestedCalendarCards: true,
        desktopDialog: true,
        browserEngine: engine,
        touchSwipes: engine === "Chromium",
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS (${engine}): narrow-phone forms, ${engine === "Chromium" ? "touch swipes and locked background, " : "scroll containment, "}footer, unsaved edits, calendars and desktop dialog.`,
  );
} catch (error) {
  console.error(logs.slice(-2000));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
