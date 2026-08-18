import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import { indexRoute } from "./app/routes";

const app: Application = express();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
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

// API Routes:
app.use("/api/v1", indexRoute);


app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

//Global Error Handler:
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Error:", err);

  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

export default app;
