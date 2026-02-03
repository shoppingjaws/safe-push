import type { CheckResult } from "../types";

/**
 * 成功メッセージを表示
 */
export function printSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

/**
 * エラーメッセージを表示
 */
export function printError(message: string): void {
  console.error(`❌ ${message}`);
}

/**
 * 警告メッセージを表示
 */
export function printWarning(message: string): void {
  console.warn(`⚠️  ${message}`);
}

/**
 * 情報メッセージを表示
 */
export function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

/**
 * チェック結果をJSON形式で出力
 */
export function printCheckResultJson(result: CheckResult): void {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * チェック結果を人間が読みやすい形式で出力
 */
export function printCheckResultHuman(result: CheckResult): void {
  const { allowed, reason, details } = result;

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log(allowed ? "✅ Push ALLOWED" : "❌ Push BLOCKED");
  console.log("═══════════════════════════════════════");
  console.log("");
  console.log(`Reason: ${reason}`);
  console.log("");
  console.log("Details:");
  console.log(`  Branch:              ${details.currentBranch}`);
  console.log(`  New branch:          ${details.isNewBranch ? "Yes" : "No"}`);
  console.log(`  Last commit author:  ${details.authorEmail}`);
  console.log(`  Local user email:    ${details.localEmail}`);
  console.log(
    `  Own last commit:     ${details.isOwnLastCommit ? "Yes" : "No"}`
  );
  console.log(
    `  Forbidden changes:   ${details.hasForbiddenChanges ? "Yes" : "No"}`
  );

  if (details.forbiddenFiles.length > 0) {
    console.log("");
    console.log("Forbidden files changed:");
    for (const file of details.forbiddenFiles) {
      console.log(`  - ${file}`);
    }
  }
  console.log("");
}

/**
 * ユーザーに確認を求める（y/n）
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const prompt = `${message} [y/N]: `;
  process.stdout.write(prompt);

  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  return false;
}
