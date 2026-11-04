import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { getDiffContentForFiles, getDiffFiles } from "./git";
import { checkPush } from "./checker";

const root = process.cwd();
const email = "developer@example.test";
let fixture: string;
let previousEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  previousEnv = { ...process.env };
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.SAFE_PUSH_EMAIL = email;
  await mkdir(join(root, ".codex-tmp"), { recursive: true });
  fixture = await mkdtemp(join(root, ".codex-tmp/git-test-"));
  process.chdir(fixture);
  await git("init", "-b", "main");
  await git("config", "user.name", "Developer");
  await git("config", "user.email", email);
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", "/dev/null");
});

afterEach(async () => {
  process.chdir(root);
  process.env = previousEnv;
  await rm(fixture, { recursive: true, force: true });
});

describe("getDiffFiles", () => {
  it("should list the full HEAD tree for unrelated histories", async () => {
    await unrelatedHistories();

    const files = await getDiffFiles();

    expect(files.sort()).toEqual([".github/workflows/ci.yml", "app.txt"]);
  });

  it("should compare from the common ancestor when the remote advances", async () => {
    await commitFile("base.txt", "base\n");
    await git("checkout", "-b", "feature");
    await commitFile("feature.txt", "feature\n");
    await git("checkout", "main");
    await commitFile("remote.txt", "remote\n");
    await git("update-ref", "refs/remotes/origin/main", "HEAD");
    await git("checkout", "feature");

    const files = await getDiffFiles();

    expect(files).toEqual(["feature.txt"]);
  });
});

describe("getDiffContentForFiles", () => {
  it("should show unrelated HEAD files as additions even if present in the remote tree", async () => {
    await unrelatedHistories();

    const diffs = await getDiffContentForFiles([".github/workflows/ci.yml"]);

    expect(Object.keys(diffs)).toEqual([".github/workflows/ci.yml"]);
    expect(diffs[".github/workflows/ci.yml"]).toContain("new file mode");
    expect(diffs[".github/workflows/ci.yml"]).toContain("+name: CI");
  });
});

describe("checkPush", () => {
  it("should block forbidden files and provide their diff without a common ancestor", async () => {
    await unrelatedHistories();

    const result = await checkPush({ forbiddenPaths: [".github/"], onForbidden: "error" });

    expect(result.allowed).toBe(false);
    expect(result.details.forbiddenFiles).toEqual([".github/workflows/ci.yml"]);
    expect(result.details.forbiddenDiff?.[".github/workflows/ci.yml"]).toContain("+name: CI");
  });
});

// Helpers
async function git(...args: string[]): Promise<void> {
  await $`git ${args} < ${Buffer.alloc(0)}`.quiet();
}

async function commitFile(path: string, content: string): Promise<void> {
  await mkdir(join(fixture, path, ".."), { recursive: true });
  await writeFile(path, content);
  await git("add", "--", path);
  await git("commit", "-m", `Add ${path}`);
}

async function unrelatedHistories(): Promise<void> {
  await commitFile(".github/workflows/ci.yml", "name: CI\n");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("checkout", "--orphan", "feature");
  await git("rm", "-rf", ".");
  await commitFile(".github/workflows/ci.yml", "name: CI\n");
  await commitFile("app.txt", "application\n");
}
