import type { Config, CheckResult } from "./types";
import {
  getCurrentBranch,
  isNewBranch,
  getLastCommitAuthorEmail,
  getLocalEmail,
  getDiffFiles,
} from "./git";

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

  // 禁止エリアに変更がある場合は常にブロック
  if (hasForbiddenChanges) {
    return {
      allowed: false,
      reason: `Forbidden files detected: ${forbiddenFiles.join(", ")}`,
      details,
    };
  }

  // 新規ブランチの場合は許可
  if (newBranch) {
    return {
      allowed: true,
      reason: "New branch - no restrictions",
      details,
    };
  }

  // 最終コミットが自分の場合は許可
  if (isOwnLastCommit) {
    return {
      allowed: true,
      reason: "Last commit is yours",
      details,
    };
  }

  // それ以外はブロック
  return {
    allowed: false,
    reason: `Last commit is by someone else (${authorEmail})`,
    details,
  };
}
