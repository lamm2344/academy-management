# Hệ thống quản lý học viên

Ứng dụng quản lý học viên, điểm danh, điểm thi và kết quả đào tạo của học viện.

## Run & Operate

- The Replit preview starts the academy web app and API server using their configured artifact workflows.
- `pnpm --filter @workspace/academy-management run dev` — run the web app through its managed workflow.
- `pnpm --filter @workspace/api-server run dev` — run the API through its managed workflow.
- `pnpm run typecheck` — typecheck the workspace.
- `pnpm --filter @workspace/db run push` — push development database schema changes.
- The API uses Replit's `DATABASE_URL`. Set `ACADEMY_ADMIN_PASSWORD` in Replit Secrets before the first login to choose the initial admin password.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

The academy portal manages courses, student records, internships, attendance, exam scores, grade summaries, violations, certificates, and role-based accounts. Internship records are manager-only and include a national ID number.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
