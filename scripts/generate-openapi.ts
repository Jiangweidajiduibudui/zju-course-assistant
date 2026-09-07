import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { api } from "../src/shared/contracts/api.js";
import {
  CONTRACT_VERSION,
  errorStatus,
  Failure,
  Id,
  success,
} from "../src/shared/contracts/common.js";
import * as contracts from "../src/shared/contracts/index.js";

// Generated schemas capture structure; docs/Contracts.md and contract tests also
// specify cross-reference checks that JSON Schema cannot express.
const registry = z.registry<{ id: string }>();
function register(value: z.ZodType, name: string) {
  const existing = registry.get(value);
  if (existing) return existing.id;
  registry.add(value, { id: name });
  return name;
}
for (const [name, value] of Object.entries(contracts)) {
  if (value instanceof z.ZodType) register(value, name);
}
const paths: Record<string, Record<string, unknown>> = {};
function schema(value: z.ZodType) {
  const { $schema: _dialect, ...converted } = z.toJSONSchema(value, {
    target: "draft-2020-12",
    io: "input",
  });
  return converted;
}
register(Failure, "Failure");
for (const [operationId, route] of Object.entries(api)) {
  const responseName = register(
    success(route.response),
    `${operationId}Response`,
  );
  const parameters: unknown[] = [];
  for (const [location, object] of [
    ["path", route.params],
    ["query", route.query],
  ] as const) {
    for (const [name, field] of Object.entries(object.shape)) {
      parameters.push({
        name,
        in: location,
        required: location === "path" || !field.isOptional(),
        schema: schema(field),
      });
    }
  }
  if (route.idempotencyKey)
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: schema(Id),
    });
  const codes = new Set([
    "INVALID_REQUEST",
    "LOCAL_AUTH_REQUIRED",
    "ORIGIN_REJECTED",
    "NOT_FOUND",
    "PAYLOAD_TOO_LARGE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    ...(route.availability === "reserved"
      ? (["FEATURE_NOT_IMPLEMENTED", "LLM_NOT_IMPLEMENTED"] as const)
      : []),
    ...route.errors,
  ] as const);
  if (route.idempotencyKey) codes.add("IDEMPOTENCY_CONFLICT");
  const byStatus = new Map<number, string[]>();
  for (const code of codes) {
    const status = errorStatus[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses: Record<string, unknown> = {
    [route.successStatus]: {
      description:
        route.availability === "reserved"
          ? "Reserved provider capability; current service returns 501"
          : "Success",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${responseName}` },
        },
      },
    },
  };
  for (const [status, errorCodes] of byStatus)
    responses[status] = {
      description: errorCodes.join(", "),
      "x-error-codes": errorCodes,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Failure" },
        },
      },
    };
  let requestBody: unknown;
  if (route.body !== null) {
    const name = register(route.body, `${operationId}Request`);
    requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${name}` },
        },
      },
    };
  }
  const path = paths[route.path] ?? {};
  path[route.method.toLowerCase()] = {
    operationId,
    summary: route.summary,
    "x-availability": route.availability,
    security: route.auth === "bootstrap" ? [] : [{ LocalToken: [] }],
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses,
  };
  paths[route.path] = path;
}
const generated = z.toJSONSchema(registry, {
  target: "draft-2020-12",
  io: "input",
  uri: (id) => `#/components/schemas/${id}`,
});
const schemas = Object.fromEntries(
  Object.entries(generated.schemas).map(([name, value]) => {
    // Component references resolve from the OpenAPI root, not a fragment $id.
    const { $id: _id, $schema: _dialect, ...component } = value;
    return [name, component];
  }),
);
const result = {
  openapi: "3.1.0",
  info: {
    title: "ZJU Course Assistant local API",
    version: CONTRACT_VERSION,
    description:
      "Local API contract 2.1. Cross-object invariants are enforced by shared schemas and deterministic domain validation.",
  },
  servers: [{ url: "/", description: "Same-origin loopback server" }],
  paths,
  components: {
    securitySchemes: {
      LocalToken: {
        type: "apiKey",
        in: "header",
        name: "X-Local-Token",
        description:
          "Local process request token; unrelated to school authentication",
      },
    },
    schemas,
  },
};
const output = `${JSON.stringify(result, null, 2)}\n`;
const file = "docs/api/openapi.json";
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== output)
    throw new Error(
      "OpenAPI drift: run pnpm contracts:generate and review the change",
    );
  console.log(`OpenAPI matches ${Object.keys(api).length} frozen operations.`);
} else {
  mkdirSync("docs/api", { recursive: true });
  writeFileSync(file, output);
  console.log(`Generated ${file}: ${Object.keys(api).length} operations.`);
}
