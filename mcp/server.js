/* ============================================================
   UGC Creator DB — MCP server
   - Streamable HTTP transport on /mcp
   - Bearer-token auth (MCP_TOKEN env var; empty disables auth)
   - Tool implementations wrap the existing /api/* REST endpoints
   ============================================================ */

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, TOOL_BY_NAME } from "./tools.js";

const PORT = Number(process.env.PORT || 3100);
const TOKEN = (process.env.MCP_TOKEN || "").trim();

const app = express();
app.use(express.json({ limit: "5mb" }));

/* ---------- bearer auth ---------- */
/* Skipped entirely if MCP_TOKEN is empty (local LAN trust). */
function authMiddleware(req, res, next) {
  // Health endpoint is unauthenticated so the user can probe through the tunnel.
  if (req.path === "/health") return next();
  if (!TOKEN) return next();
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || provided !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
app.use(authMiddleware);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "ugc-creator-db",
    tools: TOOLS.map((t) => t.name),
    authRequired: !!TOKEN,
  });
});

/* ---------- MCP server ---------- */

const server = new Server(
  { name: "ugc-creator-db", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const tool = TOOL_BY_NAME[name];
  if (!tool) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }],
      isError: true,
    };
  }
  try {
    return await tool.handler(args);
  } catch (e) {
    console.error(`[tool:${name}]`, e);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: e.message || "tool failed",
          upstreamStatus: e.upstreamStatus,
        }),
      }],
      isError: true,
    };
  }
});

/* ---------- streamable HTTP transport ----------
   Stateless mode: each request gets a fresh transport, no session id is
   tracked between calls. This matches how Claude.ai remote connectors
   currently call MCP servers and keeps the server simple. */

app.all("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,  // stateless
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[/mcp]", e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "internal error" },
        id: null,
      });
    }
  }
});

/* Root: a friendly probe. */
app.get("/", (_req, res) => {
  res.type("text/plain").send(
    "ugc-creator-db MCP server\n" +
    `tools: ${TOOLS.map((t) => t.name).join(", ")}\n` +
    `auth: ${TOKEN ? "bearer token required" : "open (no MCP_TOKEN set)"}\n` +
    "endpoint: POST /mcp (streamable HTTP)\n",
  );
});

app.listen(PORT, () => {
  console.log(`ugc-mcp listening on :${PORT}`);
  console.log(`auth: ${TOKEN ? "bearer token required" : "OPEN — set MCP_TOKEN in .env to lock down"}`);
  console.log(`tools: ${TOOLS.map((t) => t.name).join(", ")}`);
});
