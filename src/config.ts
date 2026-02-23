import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as jsonc from "jsonc-parser";
import { ConfigSchema, ConfigError, type Config } from "./types";

/**
 * 設定ファイルのデフォルトパス
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), ".config", "safe-push", "config.jsonc");
}

/**
 * デフォルト設定
 */
export function getDefaultConfig(): Config {
  return {
    forbiddenPaths: [".github/"],
    onForbidden: "error",
  };
}

/**
 * 設定ファイルが存在するか確認
 */
export function configExists(configPath?: string): boolean {
  const filePath = configPath ?? getConfigPath();
  return fs.existsSync(filePath);
}

/**
 * 設定ファイルを読み込む
 */
export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? getConfigPath();

  if (!fs.existsSync(filePath)) {
    // 設定ファイルがない場合はデフォルト設定を返す
    return getDefaultConfig();
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(content, errors);

    if (errors.length > 0) {
      const errorMessages = errors
        .map(
          (e) => `${jsonc.printParseErrorCode(e.error)} at offset ${e.offset}`
        )
        .join(", ");
      throw new ConfigError(
        `Failed to parse config file: ${errorMessages}`,
        filePath
      );
    }

    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new ConfigError(`Invalid config: ${issues}`, filePath);
    }

    return result.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(
      `Failed to read config file: ${error instanceof Error ? error.message : String(error)}`,
      filePath
    );
  }
}

/**
 * 設定ファイルを保存する
 */
export function saveConfig(config: Config, configPath?: string): void {
  const filePath = configPath ?? getConfigPath();
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const allowedVisibilitySection = config.allowedVisibility
    ? `,\n  // 許可するリポジトリ visibility: "public" | "private" | "internal"\n  "allowedVisibility": ${JSON.stringify(config.allowedVisibility)}`
    : "";

  const traceSection = config.trace
    ? `,\n  // トレーシング: "otlp" | "console" （省略で無効）\n  "trace": "${config.trace}"`
    : "";

  const content = `{
  // 禁止エリア（Globパターン）
  "forbiddenPaths": ${JSON.stringify(config.forbiddenPaths, null, 4).replace(/\n/g, "\n  ")},
  // 禁止時の動作: "error" | "prompt"
  "onForbidden": "${config.onForbidden}"${allowedVisibilitySection}${traceSection}
}
`;

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * 設定ファイルを初期化（既存の場合は上書きしない）
 */
export function initConfig(
  configPath?: string,
  force = false
): { created: boolean; path: string } {
  const filePath = configPath ?? getConfigPath();

  if (fs.existsSync(filePath) && !force) {
    return { created: false, path: filePath };
  }

  saveConfig(getDefaultConfig(), filePath);
  return { created: true, path: filePath };
}
