import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const academyUsersTable = pgTable(
  "academy_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("academy_users_role_idx").on(table.role)],
);

export const academySessionsTable = pgTable(
  "academy_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => academyUsersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("academy_sessions_user_idx").on(table.userId),
    index("academy_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const academyDocumentsTable = pgTable(
  "academy_documents",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull().$type<unknown>(),
    updatedBy: uuid("updated_by").references(() => academyUsersTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("academy_documents_updated_at_idx").on(table.updatedAt)],
);

export const academyMetaTable = pgTable("academy_meta", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});

export type AcademyUser = typeof academyUsersTable.$inferSelect;
