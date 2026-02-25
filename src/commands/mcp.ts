import { Command } from "commander";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as path from "node:path";
import { loadConfig } from "../config";
import { checkPush, checkVisibility } from "../checker";
import { isGitRepository, hasCommits, execPush } from "../git";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "safe-push",
    version: "0.3.0",
  });

  server.tool(
    "push",
    "Run safety checks and execute git push. Checks forbidden paths, branch ownership, and repository visibility before pushing.",
    {
      force: z
        .boolean()
        .optional()
        .describe(
          "Bypass safety checks (except visibility). Use when a previous push was blocked and you want to override."
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe("Show what would be pushed without actually pushing."),
      args: z
        .array(z.string())
        .optional()
        .describe(
          "Additional git push arguments (e.g. remote name, refspec, flags like --no-verify)."
        ),
    },
    async ({ force, dryRun, args }) => {
      try {
        // SAFE_PUSH_GIT_ROOT が設定されている場合は chdir
        const gitRoot = process.env.SAFE_PUSH_GIT_ROOT;
        if (gitRoot) {
          process.chdir(path.resolve(gitRoot));
        }

        // Git リポジトリ内か確認
        if (!(await isGitRepository())) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Not a git repository",
              },
            ],
            isError: true,
          };
        }

        // コミットが存在するか確認
        if (!(await hasCommits())) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No commits found",
              },
            ],
            isError: true,
          };
        }

        const config = loadConfig();
        const gitArgs = args ?? [];

        // visibility チェック（force でもバイパス不可）
        if (config.allowedVisibility && config.allowedVisibility.length > 0) {
          try {
            const visibilityResult = await checkVisibility(
              config.allowedVisibility
            );
            if (visibilityResult && !visibilityResult.allowed) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Blocked: ${visibilityResult.reason}`,
                  },
                ],
                isError: true,
              };
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to check repository visibility. Ensure 'gh' CLI is installed and authenticated.\n${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }

        // force の場合はチェックをスキップ
        if (force) {
          if (dryRun) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Dry run: would push (checks bypassed with force)",
                },
              ],
            };
          }

          const result = await execPush(gitArgs);
          if (result.success) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: result.output
                    ? `Push successful (force)\n${result.output}`
                    : "Push successful (force)",
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Push failed: ${result.output}`,
              },
            ],
            isError: true,
          };
        }

        // 通常のチェック
        const checkResult = await checkPush(config);

        if (!checkResult.allowed) {
          const details = checkResult.details;
          let message = `Push blocked: ${checkResult.reason}\n\nDetails:\n- Branch: ${details.currentBranch}\n- New branch: ${details.isNewBranch}\n- Own last commit: ${details.isOwnLastCommit}\n- Author: ${details.authorEmail}\n- Local: ${details.localEmail}`;

          if (details.forbiddenFiles.length > 0) {
            message += `\n- Forbidden files: ${details.forbiddenFiles.join(", ")}`;
          }

          // onForbidden: "prompt" の場合、MCP ではインタラクティブ確認不可なので force を案内
          if (
            config.onForbidden === "prompt" &&
            details.hasForbiddenChanges
          ) {
            message +=
              '\n\nThis repository is configured with onForbidden: "prompt". Since interactive confirmation is not available via MCP, you can re-run with force: true to bypass this check.';
          }

          return {
            content: [
              {
                type: "text" as const,
                text: message,
              },
            ],
            isError: true,
          };
        }

        // チェック通過
        if (dryRun) {
          const details = checkResult.details;
          return {
            content: [
              {
                type: "text" as const,
                text: `Dry run: would push\nReason: ${checkResult.reason}\nBranch: ${details.currentBranch}`,
              },
            ],
          };
        }

        // push 実行
        const result = await execPush(gitArgs);
        if (result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: result.output
                  ? `Push successful\n${result.output}`
                  : "Push successful",
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Push failed: ${result.output}`,
            },
          ],
          isError: true,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("safe-push MCP server started (stdio)");
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

async function startHttpServer(port: number): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );

      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      const method = req.method?.toUpperCase();

      if (method === "POST") {
        try {
          const body = await readBody(req);
          const parsedBody = JSON.parse(body);
          const sessionId = req.headers["mcp-session-id"] as
            | string
            | undefined;

          let transport: StreamableHTTPServerTransport;

          if (sessionId && transports.has(sessionId)) {
            transport = transports.get(sessionId)!;
          } else if (!sessionId && isInitializeRequest(parsedBody)) {
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid: string) => {
                transports.set(sid, transport);
                console.error(`Session initialized: ${sid}`);
              },
            });

            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) {
                transports.delete(sid);
                console.error(`Session closed: ${sid}`);
              }
            };

            const server = createMcpServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, parsedBody);
            return;
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32000,
                  message: "Bad Request: No valid session ID provided",
                },
                id: null,
              })
            );
            return;
          }

          await transport.handleRequest(req, res, parsedBody);
        } catch {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
              })
            );
          }
        }
      } else if (method === "GET") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid or missing session ID");
          return;
        }
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
      } else if (method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Invalid or missing session ID");
          return;
        }
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
      }
    }
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.error(`safe-push MCP server started (HTTP) on port ${port}`);
    });
    httpServer.on("close", resolve);
  });
}

export function createMcpCommand(): Command {
  const cmd = new Command("mcp")
    .description("Start MCP server for Claude Code integration")
    .option("--http", "Start as HTTP server instead of stdio")
    .option("--port <number>", "HTTP server port (default: PORT env or 3000)")
    .action(async (opts: { http?: boolean; port?: string }) => {
      if (opts.http) {
        const port = opts.port
          ? Number(opts.port)
          : Number(process.env.PORT) || 3000;
        await startHttpServer(port);
      } else {
        await startStdioServer();
      }
    });

  return cmd;
}
