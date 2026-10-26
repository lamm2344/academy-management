import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  academyDocumentsTable,
  academyMetaTable,
  academySessionsTable,
  academyUsersTable,
  db,
} from "@workspace/db";

export type AcademyRole = "quanly" | "giangvien" | "trogiang";

export type AcademyPrincipal = {
  id: string;
  username: string;
  name: string;
  role: AcademyRole;
  mustChangePassword: boolean;
};

const SESSION_COOKIE = "academy.sid";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_SHIFTS = [
  { id: "sh_morning", name: "Ca sáng", startTime: "07:30", endTime: "11:30" },
  { id: "sh_afternoon", name: "Ca chiều", startTime: "13:30", endTime: "17:30" },
  { id: "sh_evening", name: "Ca tối", startTime: "18:00", endTime: "21:00" },
];

const localDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const demoStudentOne = "demo-student-01";
const demoStudentTwo = "demo-student-02";
const demoCourse = "demo-course-2026";

function initialDocuments(): Array<{ key: string; value: unknown }> {
  const date = localDate();
  const courses = [
    {
      id: demoCourse,
      name: "Khoá đào tạo mẫu 2026",
      startDate: date,
      shiftIds: ["sh_morning", "sh_afternoon"],
      days: [{ date, name: "Buổi học minh hoạ", shiftIds: ["sh_morning"] }],
      attendanceMode: "session",
      attendanceMax: 10,
      attendanceAuto: true,
      attendanceCap: null,
      attendancePenalties: { late: 0.25, excused: 0.5, unexcused: 1 },
      attendancePercentages: { present: 100, late: 50, excused: 0, unexcused: 0 },
      defaultSessionPoints: 1,
      passMark: 5,
      gradeWeights: {
        attendance: 1,
        group: 1,
        bonus: 1,
        evaluation: 1,
        round1: 1,
        round2: 1,
        round3: 1,
        round4: 1,
      },
    },
  ];
  const students = [
    {
      id: demoStudentOne,
      courseId: demoCourse,
      name: "Học viên Demo 01",
      nationalId: "DEMO-001",
      force: "Cảnh sát cơ động",
    },
    {
      id: demoStudentTwo,
      courseId: demoCourse,
      name: "Học viên Demo 02",
      nationalId: "DEMO-002",
      force: "Cảnh sát giao thông",
    },
  ];

  return [
    { key: "courses", value: courses },
    { key: "students", value: students },
    { key: "shifts", value: DEFAULT_SHIFTS },
    {
      key: "scores",
      value: [
        {
          id: "demo-score-01",
          studentId: demoStudentOne,
          exam: "Kiểm tra giữa kỳ",
          point: 8.5,
          date,
          note: "Dữ liệu minh hoạ",
          by: "admin",
        },
      ],
    },
    {
      key: "violations",
      value: [
        {
          id: "demo-violation-01",
          studentId: demoStudentTwo,
          type: "Đi muộn / về sớm",
          date,
          note: "Bản ghi minh hoạ",
          by: "admin",
        },
      ],
    },
    {
      key: "certificates",
      value: [
        {
          id: "demo-certificate-01",
          number: "CN-DEMO-2026-0001",
          studentId: demoStudentOne,
          type: "Chứng nhận hoàn thành khoá học",
          rank: "Thiếu uý",
          unit: "Đơn vị minh hoạ",
          grade: "Giỏi",
          date,
          expiresAt: null,
          note: "Dữ liệu minh hoạ",
          revoked: false,
          by: "admin",
        },
      ],
    },
    {
      key: `grades:${demoCourse}`,
      value: {
        [demoStudentOne]: {
          attendance: 9,
          group: 8,
          bonus: 0,
          evaluation: 8,
          round1: 8.5,
          round2: null,
          round3: null,
          round4: null,
        },
        [demoStudentTwo]: {
          attendance: 8,
          group: null,
          bonus: null,
          evaluation: null,
          round1: null,
          round2: null,
          round3: null,
          round4: null,
        },
      },
    },
    {
      key: `attendance:${demoCourse}|${date}|sh_morning`,
      value: {
        courseId: demoCourse,
        date,
        shiftId: "sh_morning",
        instructor: "Giảng viên Demo",
        assistant: "Trợ giảng Demo",
        sessionPoints: 1,
        records: [
          { studentId: demoStudentOne, status: "present", note: "" },
          { studentId: demoStudentTwo, status: "late", note: "Dữ liệu minh hoạ" },
        ],
      },
    },
  ];
}

let initialization: Promise<void> | undefined;

export async function ensureAcademyInitialized(): Promise<void> {
  initialization ??= (async () => {
    const [existingUser] = await db
      .select({ id: academyUsersTable.id })
      .from(academyUsersTable)
      .limit(1);

    if (!existingUser) {
      const configuredPassword =
        process.env["ACADEMY_ADMIN_PASSWORD"] ?? process.env["ADMIN_PASSWORD"];
      const initialPassword = configuredPassword || "admin123";
      await db
        .insert(academyUsersTable)
        .values({
          username: "admin",
          name: "Quản lý",
          role: "quanly",
          passwordHash: hashPassword(initialPassword),
          mustChangePassword: !configuredPassword,
        })
        .onConflictDoNothing();
    }

    const existingDocuments = await db
      .select({ key: academyDocumentsTable.key })
      .from(academyDocumentsTable);
    const existingKeys = new Set(existingDocuments.map((row) => row.key));
    const missingDocuments = initialDocuments().filter(
      (document) => !existingKeys.has(document.key),
    );
    if (missingDocuments.length > 0) {
      await db.insert(academyDocumentsTable).values(
        missingDocuments.map((document) => ({
          ...document,
          value: document.value as never,
        })),
      ).onConflictDoNothing();
    }

    await db
      .insert(academyMetaTable)
      .values({ key: "revision", value: 1 })
      .onConflictDoNothing();
  })();

  try {
    await initialization;
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyPassword(
  username: string,
  password: string,
  storedHash: string,
): boolean {
  if (storedHash.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = storedHash.split("$");
    if (!saltHex || !hashHex) return false;
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
    return safeEqual(actual, hashHex);
  }

  if (storedHash.startsWith("legacy:")) {
    const legacy = createHash("sha256")
      .update(`hvqg|${username}|${password}`)
      .digest("hex");
    return safeEqual(legacy, storedHash.slice("legacy:".length));
  }

  return false;
}

export const newSessionToken = (): string => randomBytes(32).toString("hex");
export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

const secureCookie =
  process.env["COOKIE_SECURE"] === "1" || process.env["NODE_ENV"] === "production";

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie,
    path: "/",
  });
}

export function publicUser(user: {
  id: string;
  username: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
}): AcademyPrincipal {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role as AcademyRole,
    mustChangePassword: user.mustChangePassword,
  };
}

export const requireAcademyAuth: RequestHandler = async (req, res, next) => {
  await ensureAcademyInitialized();
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "Chưa đăng nhập" });
    return;
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select({
      session: academySessionsTable,
      user: academyUsersTable,
    })
    .from(academySessionsTable)
    .innerJoin(
      academyUsersTable,
      eq(academySessionsTable.userId, academyUsersTable.id),
    )
    .where(eq(academySessionsTable.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.session.expiresAt.getTime() <= Date.now()) {
    if (session) {
      await db
        .delete(academySessionsTable)
        .where(eq(academySessionsTable.tokenHash, tokenHash));
    }
    clearSessionCookie(res);
    res.status(401).json({ error: "Phiên đăng nhập đã hết hạn" });
    return;
  }

  res.locals.academyUser = publicUser(session.user);
  res.locals.academySessionHash = tokenHash;
  next();
};

export const requireAcademyManager: RequestHandler = (_req, res, next) => {
  const user = res.locals.academyUser as AcademyPrincipal | undefined;
  if (user?.role !== "quanly") {
    res.status(403).json({ error: "Chỉ Quản lý mới được thực hiện thao tác này" });
    return;
  }
  next();
};

export const requireAcademyCsrf: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) {
    next();
    return;
  }
  if (req.get("x-requested-with") !== "hocvien") {
    res.status(403).json({ error: "Yêu cầu không hợp lệ" });
    return;
  }
  next();
};

export function academyUserFromResponse(res: Response): AcademyPrincipal {
  return res.locals.academyUser as AcademyPrincipal;
}

export function academySessionHashFromResponse(res: Response): string {
  return res.locals.academySessionHash as string;
}

export async function getRevision(): Promise<number> {
  const [row] = await db
    .select({ value: academyMetaTable.value })
    .from(academyMetaTable)
    .where(eq(academyMetaTable.key, "revision"))
    .limit(1);
  return row?.value ?? 1;
}

export async function bumpRevision(): Promise<number> {
  const [updated] = await db
    .update(academyMetaTable)
    .set({ value: sql`${academyMetaTable.value} + 1` })
    .where(eq(academyMetaTable.key, "revision"))
    .returning({ value: academyMetaTable.value });
  return updated?.value ?? (await getRevision());
}
