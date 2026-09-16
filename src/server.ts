import "dotenv/config";

// Force the trading region's wall clock (Render presets TZ=UTC).
const businessTz = process.env.BUSINESS_TZ || "Asia/Dhaka";
try {
    Intl.DateTimeFormat("en-US", { timeZone: businessTz }).format();
    process.env.TZ = businessTz;
} catch {
    process.env.TZ = "Asia/Dhaka";
}

import app from "./app";
import { prisma } from "./app/lib/prisma";

const port = Number(process.env.PORT) || 4000;

const bootstrap = async () => {
  try {
    const server = app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
      console.log(`Health check available at http://localhost:${port}/health`);
    });

    const shutdown = async (signal: string) => {
      console.log(`${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        await prisma.$disconnect();
        console.log("HTTP server closed and Prisma disconnected.");
        process.exit(0);
      });
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    
  } catch (error) {
    console.error("Failed to start the server:", error);
    process.exit(1);
  }
};

void bootstrap();
