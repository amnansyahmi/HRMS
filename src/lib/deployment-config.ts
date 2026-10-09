type Environment = Record<string, string | undefined>;
export function appUrlIssue(env: Environment = process.env) {
  const value = env.APP_URL;
  if (!value)
    return env.NODE_ENV === "production"
      ? "Configure APP_URL before using this deployment"
      : null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (env.NODE_ENV === "production" && url.protocol !== "https:")
    )
      return "Set APP_URL to the exact site address, using HTTPS in production and no page path";
  } catch {
    return "APP_URL is invalid. Set it to the exact site address, including https://";
  }
  return null;
}
export interface SetupCheck {
  id: string;
  title: string;
  ready: boolean;
  keys: string[];
  detail: string;
}
/** Reports presence/format only. No connection strings, tokens or provider responses leave the server. */
export function deploymentChecks(env: Environment = process.env): SetupCheck[] {
  const validHttps = (value?: string) => {
    try {
      return new URL(value || "").protocol === "https:";
    } catch {
      return false;
    }
  };
  return [
    {
      id: "url",
      title: "Site address",
      ready: !!env.APP_URL && !appUrlIssue(env),
      keys: ["APP_URL"],
      detail:
        appUrlIssue(env) ||
        (env.APP_URL
          ? "Configured. Use this same address when opening the workspace."
          : "Set the full site address for invitations and origin checks."),
    },
    {
      id: "database",
      title: "Production database",
      ready: !!env.DATABASE_URL,
      keys: ["DATABASE_URL"],
      detail: env.DATABASE_URL
        ? "PostgreSQL connection configured; connectivity is checked separately."
        : "Local storage is for development. Production requires a PostgreSQL connection.",
    },
    {
      id: "email",
      title: "Email delivery",
      ready: !!env.SMTP_HOST && !!env.EMAIL_FROM,
      keys: ["SMTP_HOST", "EMAIL_FROM"],
      detail:
        "Invitations, resets and email notifications use the SMTP outbox. Provider delivery must be tested separately.",
    },
    {
      id: "cron",
      title: "Reminders & outbox processing",
      ready: !!env.CRON_SECRET && env.CRON_SECRET.length >= 24,
      keys: ["CRON_SECRET"],
      detail:
        "Set a secret of at least 24 characters and arrange an authenticated scheduler for /api/cron. This check cannot confirm the scheduler is running.",
    },
    {
      id: "mfa",
      title: "Authenticator encryption",
      ready: /^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY || ""),
      keys: ["AUTH_ENCRYPTION_KEY"],
      detail:
        "A random 32-byte hex key enables encrypted authenticator setup. Preserve it across restores.",
    },
    {
      id: "backup",
      title: "Encrypted backup",
      ready: /^[a-f0-9]{64}$/i.test(env.BACKUP_ENCRYPTION_KEY || ""),
      keys: ["BACKUP_ENCRYPTION_KEY"],
      detail:
        "A separate random 32-byte hex key is required for encrypted backup. Schedule backups and test restore separately.",
    },
    {
      id: "ai",
      title: "ai-nonymauz-cloud",
      ready:
        !!env.AI_NONYMAUZ_API_KEY &&
        !!env.AI_NONYMAUZ_MODEL &&
        validHttps(env.AI_NONYMAUZ_BASE_URL),
      keys: [
        "AI_NONYMAUZ_BASE_URL",
        "AI_NONYMAUZ_API_KEY",
        "AI_NONYMAUZ_MODEL",
      ],
      detail:
        "Configure the HTTPS OpenAI-compatible endpoint and a supported model alias. Enable specialist access in workspace settings; live provider availability is not checked here.",
    },
    {
      id: "media",
      title: "Optional meeting & OCR worker",
      ready: validHttps(env.MEDIA_WORKER_URL) && !!env.MEDIA_WORKER_API_KEY,
      keys: ["MEDIA_WORKER_URL", "MEDIA_WORKER_API_KEY"],
      detail:
        "Optional: configure the private worker for transcription and remote OCR. Local OCR can use Tesseract in a supported runtime.",
    },
  ];
}
