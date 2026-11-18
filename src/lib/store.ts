import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Project, ProjectInput, Run, Settings, SettingsSchema } from "./types";

// Local JSON-file persistence. Good enough for a single-user local iteration;
// swap for a database when the app becomes multi-user.

export const DATA_DIR = path.join(process.cwd(), "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");

const g = globalThis as unknown as { __frpLocks?: Map<string, Promise<unknown>> };
const locks = (g.__frpLocks ??= new Map());

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export const newId = () => randomUUID().slice(0, 8);

// ---------- Projects ----------

const PROJECTS = path.join(DATA_DIR, "projects.json");

export const listProjects = () => readJson<Project[]>(PROJECTS, []);

export async function getProject(id: string) {
  return (await listProjects()).find((p) => p.id === id) ?? null;
}

export function createProject(input: ProjectInput) {
  return withLock(PROJECTS, async () => {
    const all = await listProjects();
    const project: Project = { ...input, id: newId(), createdAt: new Date().toISOString() };
    await writeJson(PROJECTS, [project, ...all]);
    return project;
  });
}

export function deleteProject(id: string) {
  return withLock(PROJECTS, async () => {
    const all = await listProjects();
    await writeJson(PROJECTS, all.filter((p) => p.id !== id));
  });
}

// ---------- Runs ----------

const runFile = (id: string) => path.join(RUNS_DIR, `${id.replace(/[^a-z0-9-]/gi, "")}.json`);

export const getRun = (id: string) => readJson<Run | null>(runFile(id), null);

export const saveRun = (run: Run) => withLock(runFile(run.id), () => writeJson(runFile(run.id), run));

export async function listRuns(projectId?: string): Promise<Run[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const runs = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map((f) => readJson<Run | null>(path.join(RUNS_DIR, f), null)),
  );
  return runs
    .filter((r): r is Run => !!r && (!projectId || r.projectId === projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Settings ----------

const SETTINGS = path.join(DATA_DIR, "settings.json");

export async function getSettings(): Promise<Settings> {
  return SettingsSchema.parse(await readJson<unknown>(SETTINGS, {}));
}

export async function saveSettings(s: Settings) {
  await writeJson(SETTINGS, SettingsSchema.parse(s));
}

// ---------- Secrets (Apollo OAuth tokens). Never returned to the browser. ----------

const SECRETS = path.join(DATA_DIR, "secrets.json");

export type ApolloTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope: string;
};

type Secrets = { apollo?: ApolloTokens };

export const getSecrets = () => readJson<Secrets>(SECRETS, {});

export function updateSecrets(fn: (s: Secrets) => Secrets) {
  return withLock(SECRETS, async () => {
    const next = fn(await getSecrets());
    await writeJson(SECRETS, next);
    return next;
  });
}
