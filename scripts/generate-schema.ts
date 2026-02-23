import * as fs from "node:fs";
import * as path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ConfigSchema } from "../src/types";

const jsonSchema = zodToJsonSchema(ConfigSchema, {
  name: "SafePushConfig",
  $refStrategy: "none",
});

const outPath = path.join(import.meta.dirname, "..", "config.schema.json");
fs.writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n", "utf-8");
console.log(`Generated ${outPath}`);
