import { randomUUID } from "node:crypto";
import { db, transaction } from "./db";
import {
  demoEnabled,
  defaultSettings,
  passwordHash,
  createSession,
  COOKIE,
  hashToken,
} from "./auth";
import { insertRecord } from "./hr";
import { fail } from "./errors";
import type { Actor, Role } from "./types";
import { cookies } from "next/headers";
import { localDate } from "./calculations";

export async function demoLogin(role: Role = "owner") {
  if (!demoEnabled()) fail("Demo mode is unavailable on this deployment", 404);
  const session = (await cookies()).get(COOKIE)?.value;
  const existing = session
    ? (
        await db.query<{ company_id: string }>(
          "SELECT s.company_id FROM sessions s JOIN companies c ON c.id=s.company_id WHERE s.token_hash=$1 AND s.expires_at>now() AND c.is_demo",
          [hashToken(session)],
        )
      ).rows[0]
    : null;
  const COMPANY = existing?.company_id || randomUUID();
  const DEMO_EMAIL = (role: Role) => `${role}@demo-${COMPANY}.nonymauz.invalid`;
  const hash = await passwordHash(randomUUID() + randomUUID());
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO companies(id,name,slug,settings,is_demo) VALUES($1,'Nonymauz Studio',$3,$2,true) ON CONFLICT(id) DO NOTHING",
      [
        COMPANY,
        JSON.stringify({
          ...defaultSettings,
          careersIntro:
            "Good work starts with good people. Build thoughtful digital products with our Kuala Lumpur team.",
        }),
        "nonymauz-studio-demo-" + COMPANY.slice(0, 8),
      ],
    );
    await tx.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
      COMPANY,
    ]);
    if (
      (
        await tx.query(
          "SELECT id FROM hr_records WHERE company_id=$1 LIMIT 1",
          [COMPANY],
        )
      ).rows.length
    )
      return;
    const ownerId = randomUUID();
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Amnan', $2,$3)",
      [ownerId, DEMO_EMAIL("owner"), hash],
    );
    const actor: Actor = {
      userId: ownerId,
      companyId: COMPANY,
      role: "owner",
      employeeId: null,
      name: "Amnan",
      email: DEMO_EMAIL("owner"),
    };
    const departments = [];
    for (const name of [
      "Engineering",
      "People & Operations",
      "Design",
      "Sales & Marketing",
    ])
      departments.push(
        await insertRecord(tx, actor, "department", { name, description: "" }),
      );
    const people = [
      ["Amnan", "Managing Director", "Engineering", 8800, "owner"],
      [
        "Sara Izzati",
        "People Operations Lead",
        "People & Operations",
        5600,
        "hr",
      ],
      ["Faris Hakim", "Engineering Lead", "Engineering", 7200, "manager"],
      ["Aina Rahman", "Software Engineer", "Engineering", 4800, "employee"],
      ["Zahra Lim", "Product Designer", "Design", 5100, null],
      ["Daniel Tan", "Account Executive", "Sales & Marketing", 4200, null],
      ["Nur Aisyah", "Software Engineer", "Engineering", 5200, null],
      [
        "Hafiz Azman",
        "Operations Executive",
        "People & Operations",
        3800,
        null,
      ],
    ];
    const employees = [];
    for (const [i, p] of people.entries()) {
      const [name, title, department, salary, userRole] = p;
      const email = userRole
        ? DEMO_EMAIL(userRole as Role)
        : `person${i}@demo-${COMPANY}.nonymauz.invalid`;
      const employee = await insertRecord(tx, actor, "employee", {
        name,
        email,
        title,
        departmentId: departments.find((d) => d.data.name === department)!.id,
        managerId: i > 2 ? employees[2].id : null,
        startDate: "2026-01-05",
        endDate: null,
        employmentType: "Full-time",
        status: "Active",
        salary,
        annualLeave: 18,
        sickLeave: 14,
        phone: "",
      });
      employees.push(employee);
      if (userRole) {
        const userId = userRole === "owner" ? ownerId : randomUUID();
        if (userRole !== "owner")
          await tx.query(
            "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
            [userId, name, email, hash],
          );
        await tx.query(
          "INSERT INTO memberships(user_id,company_id,role,employee_id) VALUES($1,$2,$3,$4)",
          [userId, COMPANY, userRole, employee.id],
        );
      }
    }
    const now = new Date(),
      today = localDate(now, "Asia/Kuala_Lumpur"),
      future = new Date(now.getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10);
    await insertRecord(tx, actor, "shift", {
      name: "Office hours",
      start: "09:00",
      end: "18:00",
      days: [1, 2, 3, 4, 5],
      employeeIds: employees.map((e) => e.id),
      graceMinutes: 5,
    });
    for (const [i, e] of employees.slice(1, 6).entries())
      await insertRecord(
        tx,
        actor,
        "attendance",
        {
          workDate: today,
          clockIn: today + `T01:${i === 1 ? "17" : "00"}:00.000Z`,
          clockOut: null,
          shiftId: null,
          lateMinutes: i === 1 ? 12 : 0,
          location: i === 2 ? "Remote" : "Office",
        },
        e.id,
      );
    await insertRecord(
      tx,
      actor,
      "leave",
      {
        type: "Annual",
        startDate: future,
        endDate: future,
        reason: "Family appointment",
        days: 1,
        status: "Pending",
        reviewedBy: null,
        reviewNote: "",
      },
      employees[3].id,
    );
    await insertRecord(
      tx,
      actor,
      "claim",
      {
        category: "Travel",
        date: today,
        amount: 84.5,
        description: "Travel to client workshop",
        receiptId: null,
        status: "Pending",
        reviewedBy: null,
        reviewNote: "",
      },
      employees[5].id,
    );
    await insertRecord(
      tx,
      actor,
      "claim",
      {
        category: "Equipment",
        date: today,
        amount: 129,
        description: "Laptop adapter",
        receiptId: null,
        status: "Pending",
        reviewedBy: null,
        reviewNote: "",
      },
      employees[3].id,
    );
    await insertRecord(
      tx,
      actor,
      "goal",
      {
        title: "Ship the client portal",
        target: 4,
        progress: 3,
        unit: "milestones",
        dueDate: future,
        status: "In progress",
        rating: null,
        feedback: "",
      },
      employees[3].id,
    );
    await insertRecord(
      tx,
      actor,
      "goal",
      {
        title: "Complete onboarding playbook",
        target: 10,
        progress: 6,
        unit: "chapters",
        dueDate: future,
        status: "In progress",
        rating: null,
        feedback: "",
      },
      employees[1].id,
    );
    const job = await insertRecord(tx, actor, "job", {
      title: "Frontend Engineer",
      departmentId: departments[0].id,
      location: "Kuala Lumpur · Hybrid",
      employmentType: "Full-time",
      description:
        "Build useful, accessible interfaces with our product team. You will own features from early sketches through delivery and work closely with designers and backend engineers.",
      requirements:
        "React, TypeScript, accessible HTML and CSS, REST APIs, Git and automated testing. Share examples of features you have delivered.",
      status: "Published",
    });
    await insertRecord(tx, actor, "job", {
      title: "Product Designer",
      departmentId: departments[2].id,
      location: "Kuala Lumpur · Hybrid",
      employmentType: "Full-time",
      description:
        "Help us turn complex workflows into simple experiences. Work with engineering to research, prototype, and test interfaces that people enjoy using.",
      requirements:
        "A product design portfolio, user research experience, Figma and strong interaction design fundamentals.",
      status: "Draft",
    });
    await insertRecord(tx, actor, "candidate", {
      name: "Irfan Abdullah",
      email: "candidate1@demo.nonymauz.invalid",
      phone: "",
      jobId: job.id,
      resume:
        "Frontend developer with 3 years of React and TypeScript experience. Built an accessible inventory dashboard, integrated REST APIs and maintained Playwright tests. Uses GitHub pull requests and works with a design team.",
      resumeFileId: null,
      stage: "Interview",
      notes: "Ask about testing strategy and accessibility.",
      consent: true,
    });
    await insertRecord(tx, actor, "candidate", {
      name: "Mei Wen",
      email: "candidate2@demo.nonymauz.invalid",
      phone: "",
      jobId: job.id,
      resume:
        "Web developer with 2 years of JavaScript and Vue experience. Built responsive customer portals and integrated REST services. Familiar with Git and currently learning React and TypeScript.",
      resumeFileId: null,
      stage: "Applied",
      notes: "",
      consent: true,
    });
    await insertRecord(tx, actor, "assessment", {
      title: "Frontend fundamentals",
      type: "Skills",
      instructions:
        "Choose one answer for each question. No external tools are required.",
      questions: [
        {
          prompt: "Which HTML element is best for a clickable action?",
          options: ["div", "button", "span"],
          correctIndex: 1,
        },
        {
          prompt:
            "Which HTTP status commonly indicates an unauthorized request?",
          options: ["200", "401", "500"],
          correctIndex: 1,
        },
      ],
    });
    await insertRecord(tx, actor, "assessment", {
      title: "Working together",
      type: "Work preferences",
      instructions:
        "There are no right or wrong answers. Tell us how you prefer to work.",
      questions: [
        {
          prompt: "When starting a new task, what helps you most?",
          options: [
            "A detailed written brief",
            "A quick discussion",
            "Time to explore independently",
          ],
          correctIndex: 0,
        },
        {
          prompt: "How do you prefer to receive feedback?",
          options: [
            "Written notes to reflect on",
            "A conversation in person",
            "A mix of both",
          ],
          correctIndex: 0,
        },
      ],
    });
    await insertRecord(tx, actor, "meeting", {
      title: "Weekly people check-in",
      date: today,
      transcript:
        "Sara: The onboarding playbook has six of ten chapters complete. I will draft the remaining sections next week. Faris: We need to interview the frontend candidates. I can prepare practical questions. Amnan: Let us review workload before opening another engineering position. No decision on headcount today.",
      summary:
        "Onboarding documentation is progressing. Faris will prepare interview questions. Additional headcount remains under review.",
      actions: [
        {
          task: "Draft remaining onboarding chapters",
          owner: "Sara",
          dueDate: future,
          done: false,
        },
        {
          task: "Prepare frontend interview questions",
          owner: "Faris",
          dueDate: null,
          done: false,
        },
      ],
      fileId: null,
    });
    await insertRecord(tx, actor, "policy", {
      title: "Leave and time off",
      category: "Leave",
      body: "Demo policy: submit leave requests before your planned time off. Annual and sick leave balances are configured per employee. Managers review team requests, and HR can review across the company. Weekends and configured holidays are excluded.",
    });
    await insertRecord(tx, actor, "policy", {
      title: "Expense claims",
      category: "Claims",
      body: "Demo policy: attach a receipt and describe the business purpose of each claim. HR reviews approved claims before marking them paid.",
    });
  });
  const user = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [
      DEMO_EMAIL(role),
    ])
  ).rows[0];
  await createSession(user.id, COMPANY);
}
