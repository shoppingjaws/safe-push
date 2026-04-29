import { $ } from "bun";
import { GitError } from "./types";
import { withSpan } from "./telemetry";

/**
 * Gitコマンドを実行し、結果を返す
 */
async function execGit(args: string[]): Promise<string> {
  const command = `git ${args.join(" ")}`;
  try {
    const result = await $`git ${args}`.quiet();
    return result.stdout.toString().trim();
  } catch (error) {
    if (error && typeof error === "object" && "exitCode" in error) {
      const exitCode = (error as { exitCode: number }).exitCode;
      const stderr =
        "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
      throw new GitError(
        `Git command failed: ${stderr || command}`,
        command,
        exitCode
      );
    }
    throw new GitError(`Git command failed: ${command}`, command, null);
  }
}

/**
 * 現在のブランチ名を取得
 */
export async function getCurrentBranch(): Promise<string> {
  return withSpan("safe-push.git.getCurrentBranch", async () => {
    return execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  });
}

/**
 * リモートに存在しない新規ブランチかどうかを判定
 */
export async function isNewBranch(remote = "origin"): Promise<boolean> {
  return withSpan("safe-push.git.isNewBranch", async () => {
    const branch = await getCurrentBranch();
    try {
      await execGit(["rev-parse", "--verify", `${remote}/${branch}`]);
      return false;
    } catch {
      return true;
    }
  });
}

/**
 * 最後のコミットの作者メールアドレスを取得
 */
export async function getLastCommitAuthorEmail(): Promise<string> {
  return withSpan("safe-push.git.getLastCommitAuthorEmail", async () => {
    return execGit(["log", "-1", "--format=%ae"]);
  });
}

/**
 * ローカルのGit設定からメールアドレスを取得
 */
export async function getLocalEmail(): Promise<string> {
  return withSpan("safe-push.git.getLocalEmail", async () => {
    // 環境変数が設定されている場合はそちらを優先
    const envEmail = process.env.SAFE_PUSH_EMAIL;
    if (envEmail) {
      return envEmail;
    }

    return execGit(["config", "user.email"]);
  });
}

/**
 * リモートとの比較基準ブランチを取得
 * 新規ブランチの場合はmainまたはmasterを返す
 * mainもmasterもない場合はnullを返す
 */
async function getBaseBranch(remote = "origin"): Promise<string | null> {
  const branch = await getCurrentBranch();
  const isNew = await isNewBranch(remote);

  if (isNew) {
    try {
      await execGit(["rev-parse", "--verify", `${remote}/main`]);
      return `${remote}/main`;
    } catch {
      try {
        await execGit(["rev-parse", "--verify", `${remote}/master`]);
        return `${remote}/master`;
      } catch {
        return null;
      }
    }
  } else {
    return `${remote}/${branch}`;
  }
}

/**
 * リモートとの差分ファイル一覧を取得
 * 新規ブランチの場合はmainまたはmasterとの差分を取得
 */
export async function getDiffFiles(
  remote = "origin",
  authorEmail?: string
): Promise<string[]> {
  return withSpan("safe-push.git.getDiffFiles", async () => {
    const baseBranch = await getBaseBranch(remote);
    if (!baseBranch) {
      return [];
    }

    let output: string;
    if (authorEmail) {
      // 自分のコミットで変更されたファイルのみ取得
      output = await execGit([
        "log",
        `--author=${authorEmail}`,
        "--name-only",
        "--format=",
        `${baseBranch}..HEAD`,
      ]);
    } else {
      output = await execGit([
        "diff",
        "--name-only",
        `${baseBranch}...HEAD`,
      ]);
    }
    if (!output) {
      return [];
    }

    // 重複を除去して返す
    return [...new Set(output.split("\n").filter(Boolean))];
  });
}

/**
 * 指定ファイルごとのdiffコンテンツを取得
 */
export async function getDiffContentForFiles(
  files: string[],
  remote = "origin"
): Promise<Record<string, string>> {
  return withSpan("safe-push.git.getDiffContentForFiles", async () => {
    if (files.length === 0) {
      return {};
    }

    const baseBranch = await getBaseBranch(remote);
    if (!baseBranch) {
      return {};
    }

    const output = await execGit(["diff", `${baseBranch}...HEAD`, "--", ...files]);
    if (!output) {
      return {};
    }

    // diff 出力を "diff --git" でファイルごとに分割
    const result: Record<string, string> = {};
    const sections = output.split(/^(?=diff --git )/m);
    for (const section of sections) {
      if (!section.trim()) continue;
      // "diff --git a/path b/path" からファイルパスを抽出
      const match = section.match(/^diff --git a\/(.+?) b\//);
      if (match) {
        result[match[1]] = section.trim();
      }
    }
    return result;
  });
}

/**
 * git pushを実行
 */
export async function execPush(
  args: string[] = [],
  remote = "origin"
): Promise<{ success: boolean; output: string }> {
  return withSpan("safe-push.git.execPush", async (span) => {
    let pushArgs: string[];

    // ユーザーがremote/refspecを明示的に指定したか判定
    const hasUserRefspec = args.some((arg) => !arg.startsWith("-"));

    if (hasUserRefspec) {
      // ユーザー指定のremote/refspecをそのまま使用
      pushArgs = ["push", ...args];
    } else {
      // 自動でremote/branchを決定
      const branch = await getCurrentBranch();
      const isNew = await isNewBranch(remote);

      pushArgs = ["push"];

      // 新規ブランチ、またはユーザーが-uを指定した場合に追加
      const hasSetUpstream = args.some(
        (a) => a === "-u" || a === "--set-upstream"
      );
      if (isNew || hasSetUpstream) {
        pushArgs.push("-u");
      }

      pushArgs.push(remote, branch);

      // -u/--set-upstream以外のフラグを追加
      const remainingFlags = args.filter(
        (a) => a !== "-u" && a !== "--set-upstream"
      );
      pushArgs.push(...remainingFlags);
    }

    let result: { success: boolean; output: string };
    try {
      const proc = await $`git ${pushArgs}`.quiet();
      const stdout = proc.stdout.toString().trim();
      const stderr = proc.stderr.toString().trim();
      const output = [stdout, stderr].filter(Boolean).join("\n");
      result = { success: true, output };
    } catch (error) {
      if (error && typeof error === "object" && "exitCode" in error) {
        const stderr =
          "stderr" in error ? String((error as { stderr: unknown }).stderr).trim() : "";
        const stdout =
          "stdout" in error ? String((error as { stdout: unknown }).stdout).trim() : "";
        const output = [stdout, stderr].filter(Boolean).join("\n");
        result = { success: false, output: output || `Push failed with exit code ${(error as { exitCode: number }).exitCode}` };
      } else {
        result = {
          success: false,
          output: error instanceof Error ? error.message : String(error),
        };
      }
    }

    span.addEvent("push.result", {
      success: result.success,
      hasUserRefspec,
    });

    return result;
  });
}

/**
 * リポジトリの visibility を取得（gh CLI を使用）
 */
export async function getRepoVisibility(): Promise<string> {
  return withSpan("safe-push.git.getRepoVisibility", async () => {
    const command = "gh repo view --json visibility --jq '.visibility'";
    try {
      const result = await $`gh repo view --json visibility --jq .visibility`.quiet();
      return result.stdout.toString().trim().toLowerCase();
    } catch (error) {
      if (error && typeof error === "object" && "exitCode" in error) {
        const exitCode = (error as { exitCode: number }).exitCode;
        const stderr =
          "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
        throw new GitError(
          `Failed to get repository visibility: ${stderr || command}`,
          command,
          exitCode
        );
      }
      throw new GitError(`Failed to get repository visibility: ${command}`, command, null);
    }
  });
}

/**
 * Gitリポジトリ内かどうかを確認
 */
export async function isGitRepository(): Promise<boolean> {
  return withSpan("safe-push.git.isGitRepository", async () => {
    try {
      await execGit(["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * コミットが存在するか確認
 */
export async function hasCommits(): Promise<boolean> {
  return withSpan("safe-push.git.hasCommits", async () => {
    try {
      await execGit(["rev-parse", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  });
}
