# server-starter

Express + TypeScript + Prisma + PostgreSQL starter template.

## Stack

- Express 5
- TypeScript
- Prisma 7
- PostgreSQL (`pg` + `@prisma/adapter-pg`)
- ESLint
- pnpm

## Requirements

- Node.js 20+
- pnpm 10+
- PostgreSQL database (local or hosted)

## Quick Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create your environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

3. Update `.env` values:

```env
PORT=5000
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
```

4. Generate Prisma client:

```bash
pnpm prisma:generate
```

5. Apply migrations:

```bash
pnpm prisma:migrate
```

6. Start development server:

```bash
pnpm dev
```

Server runs at `http://localhost:5000` by default.

## Environment Variables

- `PORT`: HTTP server port (default fallback in code: `4000`)
- `DATABASE_URL`: PostgreSQL connection string used by Prisma

Example hosted Prisma Postgres URL format:

```env
DATABASE_URL="postgres://USERNAME:PASSWORD@db.prisma.io:5432/postgres?sslmode=require"
```

## Available Scripts

- `pnpm dev`: Run dev server with watch mode
- `pnpm build`: Compile TypeScript to `dist`
- `pnpm start`: Run compiled server from `dist`
- `pnpm lint`: Run ESLint
- `pnpm prisma:generate`: Generate Prisma client
- `pnpm prisma:migrate`: Create/apply migrations in development
- `pnpm prisma:push`: Push schema directly to DB (without migration files)
- `pnpm prisma:pull`: Pull schema from DB
- `pnpm prisma:studio`: Open Prisma Studio

## API Endpoints

- `GET /health` -> health status
- `GET /` -> starter metadata
- `GET /api/v1` -> API readiness endpoint

## Project Structure

```text
prisma/
  schema.prisma
src/
  app.ts
  server.ts
  app/
    lib/
      prisma.ts
    routes/
      index.ts
```

## Prisma Notes

- Prisma config is in `prisma.config.ts`
- Prisma client is generated to `src/generated/prisma`
- If schema changes, run:

```bash
pnpm prisma:generate
```

## Starter Workflow (Recommended)

1. Create models in `prisma/schema.prisma`
2. Run `pnpm prisma:migrate`
3. Build routes/services for your feature modules
4. Keep `.env` private and commit only `.env.example`

## GitHub Publish Checklist

- `.env` is ignored by `.gitignore`
- `.env.example` contains non-secret placeholders
- `pnpm lint` passes
- `pnpm build` passes
- `pnpm prisma:generate` passes
