import { z } from "zod";

/**
 * 禁止時の動作
 */
export const OnForbiddenSchema = z.enum(["error", "prompt"]);
export type OnForbidden = z.infer<typeof OnForbiddenSchema>;

/**
 * リポジトリの visibility
 */
export const RepoVisibilitySchema = z.enum(["public", "private", "internal"]);
export type RepoVisibility = z.infer<typeof RepoVisibilitySchema>;

/**
 * 設定ファイルのスキーマ
 */
export const ConfigSchema = z.object({
  forbiddenPaths: z.array(z.string()).default([".github/"]),
  onForbidden: OnForbiddenSchema.default("error"),
  allowedVisibility: z.array(RepoVisibilitySchema).optional(),
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
    repoVisibility?: string;
    visibilityAllowed?: boolean;
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

/**
 * コマンドハンドラから exit code を伝搬するためのエラー。
 * process.exit() を直接呼ばず、index.ts で shutdown 後に exit する。
 */
export class ExitError extends Error {
  constructor(public readonly exitCode: number) {
    super(`Process exiting with code ${exitCode}`);
    this.name = "ExitError";
  }
}
