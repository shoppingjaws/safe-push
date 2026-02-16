import { $ } from "bun";
import { GitError } from "./types";

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
  return execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

/**
 * リモートに存在しない新規ブランチかどうかを判定
 */
export async function isNewBranch(remote = "origin"): Promise<boolean> {
  const branch = await getCurrentBranch();
  try {
    await execGit(["rev-parse", "--verify", `${remote}/${branch}`]);
    return false;
  } catch {
    return true;
  }
}

/**
 * 最後のコミットの作者メールアドレスを取得
 */
export async function getLastCommitAuthorEmail(): Promise<string> {
  return execGit(["log", "-1", "--format=%ae"]);
}

/**
 * ローカルのGit設定からメールアドレスを取得
 */
export async function getLocalEmail(): Promise<string> {
  // 環境変数が設定されている場合はそちらを優先
  const envEmail = process.env.SAFE_PUSH_EMAIL;
  if (envEmail) {
    return envEmail;
  }

  return execGit(["config", "user.email"]);
}

/**
 * リモートとの差分ファイル一覧を取得
 * 新規ブランチの場合はmainまたはmasterとの差分を取得
 */
export async function getDiffFiles(remote = "origin"): Promise<string[]> {
  const branch = await getCurrentBranch();
  const isNew = await isNewBranch(remote);

  let baseBranch: string;
  if (isNew) {
    // 新規ブランチの場合、mainまたはmasterを基準にする
    try {
      await execGit(["rev-parse", "--verify", `${remote}/main`]);
      baseBranch = `${remote}/main`;
    } catch {
      try {
        await execGit(["rev-parse", "--verify", `${remote}/master`]);
        baseBranch = `${remote}/master`;
      } catch {
        // mainもmasterもない場合は空の配列を返す
        return [];
      }
    }
  } else {
    baseBranch = `${remote}/${branch}`;
  }

  const output = await execGit(["diff", "--name-only", baseBranch, "HEAD"]);
  if (!output) {
    return [];
  }

  return output.split("\n").filter(Boolean);
}

/**
 * git pushを実行
 */
export async function execPush(
  args: string[] = [],
  remote = "origin"
): Promise<{ success: boolean; output: string }> {
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

  try {
    const output = await execGit(pushArgs);
    return { success: true, output };
  } catch (error) {
    if (error instanceof GitError) {
      return { success: false, output: error.message };
    }
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Gitリポジトリ内かどうかを確認
 */
export async function isGitRepository(): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * コミットが存在するか確認
 */
export async function hasCommits(): Promise<boolean> {
  try {
    await execGit(["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}
