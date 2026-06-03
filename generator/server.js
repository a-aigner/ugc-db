/* ============================================================
   UGC generator — HTTP shell that exposes /health and starts the worker
   that polls planned_posts and runs Higgsfield generations.
   ============================================================ */

import express from "express";
import { startWorker, stats } from "./worker.js";
import { probe } from "./higgsfield.js";

const PORT = Number(process.env.PORT || 3200);
const MOCK = String(process.env.MOCK_GENERATOR || "true").toLowerCase() !== "false";

const app = express();

app.get("/health", async (_req, res) => {
  const p = await probe();
  res.json({
    ok: true,
    name: "ugc-generator",
    mock: MOCK,
    higgsfield: p,
    ...stats(),
  });
});

app.get("/", (_req, res) => {
  res.type("text/plain").send(
    "ugc-generator\n" +
    `mode: ${MOCK ? "MOCK (set MOCK_GENERATOR=false in .env to use real Higgsfield CLI)" : "live"}\n` +
    "endpoints:\n" +
    "  GET /health   — { ok, name, mock, higgsfield, inFlight, maxConcurrent }\n",
  );
});

app.listen(PORT, () => {
  console.log(`ugc-generator listening on :${PORT}`);
  console.log(`mode: ${MOCK ? "MOCK (no Higgsfield calls)" : "LIVE (uses Higgsfield CLI)"}`);
  startWorker().catch((e) => console.error(`[worker] crashed: ${e.message}`));
});
