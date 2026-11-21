// Server-side only: used by workflow steps (never imported by client code).
import { Sandbox } from "@vercel/sandbox";

/*
 * The admin agent's persistent workspace: one named Vercel Sandbox per
 * environment, used for both computation and long-term memory.
 *
 * - Persistent: its filesystem is restored between sessions, so memory and
 *   fetched datasets survive across conversations.
 * - Isolated: commands run in a microVM with all outbound network access
 *   denied. Nothing runs on the app server or a developer's machine, and no
 *   credentials are ever passed into it.
 */

export const SANDBOX_HOME = "/vercel";
export const DATA_DIR = `${SANDBOX_HOME}/data`;
export const MEMORY_FILE = `${SANDBOX_HOME}/memory/admin-memory.md`;

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function sandboxName(): string {
  const env = process.env.VERCEL_ENV ?? "development";
  return process.env.ADMIN_SANDBOX_NAME?.trim() || `ship-it-shop-admin-${env}`;
}

export async function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: sandboxName(),
    persistent: true,
    networkPolicy: "deny-all",
    timeout: IDLE_TIMEOUT_MS,
    onCreate: async (sandbox) => {
      await sandbox.runCommand({
        cmd: "mkdir",
        args: ["-p", DATA_DIR, `${SANDBOX_HOME}/memory`],
      });
    },
  });
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const MAX_OUTPUT_CHARS = 8_000;

function clip(text: string): [string, boolean] {
  return text.length > MAX_OUTPUT_CHARS
    ? [`${text.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)`, true]
    : [text, false];
}

/** Runs a shell command in the sandbox's home directory. */
export async function runInSandbox(
  command: string,
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const sandbox = await getAdminSandbox();
  const finished = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: SANDBOX_HOME,
    env: options.env,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  const [stdout, outTruncated] = clip(await finished.stdout());
  const [stderr, errTruncated] = clip(await finished.stderr());
  return {
    exitCode: finished.exitCode,
    stdout,
    stderr,
    truncated: outTruncated || errTruncated,
  };
}

export async function writeSandboxFile(path: string, content: string): Promise<void> {
  const sandbox = await getAdminSandbox();
  await sandbox.writeFiles([{ path, content: Buffer.from(content, "utf8") }]);
}

export async function readSandboxFile(path: string): Promise<string | null> {
  const sandbox = await getAdminSandbox();
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf8") : null;
}
