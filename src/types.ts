import { z } from "zod";

/**
 * 禁止時の動作
 */
export const OnForbiddenSchema = z.enum(["error", "prompt"]);
export type OnForbidden = z.infer<typeof OnForbiddenSchema>;

/**
 * 設定ファイルのスキーマ
 */
export const ConfigSchema = z.object({
  forbiddenPaths: z.array(z.string()).default([".github/"]),
  onForbidden: OnForbiddenSchema.default("error"),
});
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Pushチェック結果
 */
export interface CheckResult {
  allowed: boolean;
  reason: string;
  details: {
    isNewBranch: boolean;
    isOwnLastCommit: boolean;
    hasForbiddenChanges: boolean;
    forbiddenFiles: string[];
    currentBranch: string;
    authorEmail: string;
    localEmail: string;
  };
}

/**
 * Git操作関連のエラー
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number | null
  ) {
    super(message);
    this.name = "GitError";
  }
}

/**
 * 設定ファイル関連のエラー
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string
  ) {
    super(message);
    this.name = "ConfigError";
  }
}
