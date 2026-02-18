import { Command } from "commander";
import { loadConfig } from "../config";
import { checkPush, checkVisibility } from "../checker";
import { isGitRepository, hasCommits, execPush } from "../git";
import {
  printError,
  printSuccess,
  printWarning,
  printCheckResultHuman,
  promptConfirm,
} from "./utils";

/**
 * pushコマンドを作成
 */
export function createPushCommand(): Command {
  return new Command("push")
    .description("Check and push if allowed")
    .option("-f, --force", "Bypass safety checks")
    .option("--dry-run", "Show what would be pushed without actually pushing")
    .allowUnknownOption()
    .action(async (options: { force?: boolean; dryRun?: boolean }, command: Command) => {
      const gitArgs = command.args;
      try {
        // Gitリポジトリ内か確認
        if (!(await isGitRepository())) {
          printError("Not a git repository");
          process.exit(1);
        }

        // コミットが存在するか確認
        if (!(await hasCommits())) {
          printError("No commits found");
          process.exit(1);
        }

        const config = loadConfig();

        // visibility チェック（--force でもバイパスできない）
        if (config.allowedVisibility && config.allowedVisibility.length > 0) {
          try {
            const visibilityResult = await checkVisibility(config.allowedVisibility);
            if (visibilityResult && !visibilityResult.allowed) {
              printError(visibilityResult.reason);
              process.exit(1);
            }
          } catch (error) {
            printError(
              `Failed to check repository visibility. Ensure 'gh' CLI is installed and authenticated.\n  ${error instanceof Error ? error.message : String(error)}`
            );
            process.exit(1);
          }
        }

        // --forceオプションが指定されている場合はチェックをスキップ
        if (options.force) {
          printWarning("Safety checks bypassed with --force");

          if (options.dryRun) {
            printSuccess("Dry run: would push (checks bypassed)");
            process.exit(0);
          }

          const result = await execPush(gitArgs);
          if (result.success) {
            printSuccess("Push successful");
            process.exit(0);
          } else {
            printError(`Push failed: ${result.output}`);
            process.exit(1);
          }
        }

        // 通常のチェックを実行
        const checkResult = await checkPush(config);
        printCheckResultHuman(checkResult);

        if (!checkResult.allowed) {
          // onForbiddenの設定に応じて動作を変更
          if (
            config.onForbidden === "prompt" &&
            checkResult.details.hasForbiddenChanges
          ) {
            const confirmed = await promptConfirm(
              "Push is blocked due to forbidden changes. Push anyway?"
            );

            if (confirmed) {
              if (options.dryRun) {
                printSuccess("Dry run: would push (user confirmed)");
                process.exit(0);
              }

              const result = await execPush(gitArgs);
              if (result.success) {
                printSuccess("Push successful");
                process.exit(0);
              } else {
                printError(`Push failed: ${result.output}`);
                process.exit(1);
              }
            } else {
              printError("Push cancelled by user");
              process.exit(1);
            }
          }

          process.exit(1);
        }

        // チェック通過、pushを実行
        if (options.dryRun) {
          printSuccess("Dry run: would push");
          process.exit(0);
        }

        const result = await execPush(gitArgs);
        if (result.success) {
          printSuccess("Push successful");
          process.exit(0);
        } else {
          printError(`Push failed: ${result.output}`);
          process.exit(1);
        }
      } catch (error) {
        printError(
          `Push failed: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }
    });
}
