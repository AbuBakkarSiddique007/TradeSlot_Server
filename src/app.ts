import express, { Application, Request, Response } from "express";
import { indexRoute } from "./app/routes";

const app: Application = express();

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/v1", indexRoute);

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    name: "express-ts-prisma-starter",
    version: "1.0.0",
    docs: "/api/v1",
    health: "/health",
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

export default app;
