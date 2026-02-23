import type { Config, CheckResult, RepoVisibility } from "./types";
import {
  getCurrentBranch,
  isNewBranch,
  getLastCommitAuthorEmail,
  getLocalEmail,
  getDiffFiles,
  getRepoVisibility,
} from "./git";
import { withSpan } from "./telemetry";

/**
 * Visibility チェック結果
 */
export interface VisibilityCheckResult {
  allowed: boolean;
  reason: string;
  visibility: string;
}

/**
 * リポジトリの visibility が許可リストに含まれるかチェック
 * allowedVisibility が未設定または空配列の場合は null を返す（チェック不要）
 */
export async function checkVisibility(
  allowedVisibility?: RepoVisibility[]
): Promise<VisibilityCheckResult | null> {
  return withSpan("safe-push.check.visibility", async (span) => {
    if (!allowedVisibility || allowedVisibility.length === 0) {
      return null;
    }

    const visibility = await getRepoVisibility();
    const allowed = allowedVisibility.includes(visibility as RepoVisibility);

    span.addEvent("visibility.result", {
      value: visibility,
      allowed,
    });

    return {
      allowed,
      reason: allowed
        ? `Repository visibility "${visibility}" is allowed`
        : `Repository visibility "${visibility}" is not in allowed list: [${allowedVisibility.join(", ")}]`,
      visibility,
    };
  });
}

/**
 * ファイルパスが禁止パターンにマッチするか判定
 */
function matchesForbiddenPath(
  filePath: string,
  forbiddenPaths: string[]
): boolean {
  for (const pattern of forbiddenPaths) {
    // 末尾にスラッシュがあるパターンはディレクトリ判定
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      if (filePath.startsWith(dirPattern + "/") || filePath === dirPattern) {
        return true;
      }
    } else {
      // Globパターンを簡易的に正規表現に変換
      const regexPattern = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(filePath)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 禁止エリアに変更があるファイルを抽出
 */
function findForbiddenFiles(
  changedFiles: string[],
  forbiddenPaths: string[]
): string[] {
  return changedFiles.filter((file) =>
    matchesForbiddenPath(file, forbiddenPaths)
  );
}

/**
 * Push可否をチェック
 *
 * Push許可条件:
 * (禁止エリア変更なし) AND (新規ブランチ OR 最終コミットが自分)
 */
export async function checkPush(config: Config): Promise<CheckResult> {
  return withSpan("safe-push.check.push", async (span) => {
    const currentBranch = await getCurrentBranch();
    const newBranch = await isNewBranch();
    const authorEmail = await getLastCommitAuthorEmail();
    const localEmail = await getLocalEmail();
    const diffFiles = await getDiffFiles();

    const forbiddenFiles = findForbiddenFiles(diffFiles, config.forbiddenPaths);
    const hasForbiddenChanges = forbiddenFiles.length > 0;
    const isOwnLastCommit =
      authorEmail.toLowerCase() === localEmail.toLowerCase();

    const details = {
      isNewBranch: newBranch,
      isOwnLastCommit,
      hasForbiddenChanges,
      forbiddenFiles,
      currentBranch,
      authorEmail,
      localEmail,
    };

    let result: CheckResult;

    // 禁止エリアに変更がある場合は常にブロック
    if (hasForbiddenChanges) {
      result = {
        allowed: false,
        reason: `Forbidden files detected: ${forbiddenFiles.join(", ")}`,
        details,
      };
    } else if (newBranch) {
      // 新規ブランチの場合は許可
      result = {
        allowed: true,
        reason: "New branch - no restrictions",
        details,
      };
    } else if (isOwnLastCommit) {
      // 最終コミットが自分の場合は許可
      result = {
        allowed: true,
        reason: "Last commit is yours",
        details,
      };
    } else {
      // それ以外はブロック
      result = {
        allowed: false,
        reason: `Last commit is by someone else (${authorEmail})`,
        details,
      };
    }

    span.addEvent("check.result", {
      allowed: result.allowed,
      reason: result.reason,
      isNewBranch: newBranch,
      isOwnLastCommit,
      hasForbiddenChanges,
      forbiddenFileCount: forbiddenFiles.length,
    });

    return result;
  });
}
