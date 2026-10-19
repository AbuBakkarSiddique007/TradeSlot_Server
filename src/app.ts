import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import { indexRoute } from "./app/routes";
import { webhookRoutes } from "./app/module/webhooks/webhook.routes";

const app: Application = express();

const defaultOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

const envOrigins = (process.env.CLIENT_BASE_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/+$/, "");

      if (
        process.env.CLIENT_BASE_URL === "*" ||
        allowedOrigins.includes(normalizedOrigin) ||
        /\.vercel\.app$/.test(new URL(origin).hostname)
      ) {
        return callback(null, true);
      }

      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 200,
  }),
);

app.use(express.urlencoded({ extended: true }));

// Mount the Stripe webhook router BEFORE express.json() so the route-local
// express.raw() receives the raw Buffer body (needed for signature verification).
// If the global JSON parser runs first, req.body becomes a parsed object and the
// controller rejects it with 400, silently breaking every webhook event.
app.use("/api/v1/webhooks", webhookRoutes);

app.use(express.json());


app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});


app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "TradeSlot API Server",
    version: "1.0.0",
    docs: "/api/v1",
    health: "/health",
  });
});

app.use("/api/v1", indexRoute);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Error:", err);

  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

export default app;
