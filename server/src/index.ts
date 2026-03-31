import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { agentRouter } from "./routes/agent";

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ──────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json());

// ─── Routes ──────────────────────────────────────
app.use("/api", agentRouter);

// ─── Start (local runtime only) ──────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🔐 Delegate API running on http://localhost:${PORT}`);
    console.log(`   Auth0 domain : ${process.env.AUTH0_DOMAIN}`);
    console.log(`   Token Vault  : active`);
    console.log(`   Tools        : slack, discord\n`);
  });
}

export default app;
