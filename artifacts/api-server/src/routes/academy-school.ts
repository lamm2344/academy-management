import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteDocumentQueryParams,
  GetDashboardResponse,
  GetRevisionResponse,
  GetSchoolStateResponse,
  RestoreBackupBody,
  RestoreBackupResponse,
  SaveDocumentBody,
  SaveDocumentResponse,
} from "@workspace/api-zod";
import type { SchoolState } from "@workspace/api-zod";
import {
  academyDocumentsTable,
  academyMetaTable,
  academyUsersTable,
  db,
} from "@workspace/db";
import {
  academyUserFromResponse,
  ensureAcademyInitialized,
  getRevision,
  publicUser,
  requireAcademyAuth,
  requireAcademyCsrf,
  type AcademyPrincipal,
} from "../lib/academy";

const router: IRouter = Router();
const stateDataSchema = GetSchoolStateResponse.shape.data;
const collections = new Set([
  "courses",
  "students",
  "internships",
  "scores",
  "violations",
  "shifts",
  "certificates",
]);
const documentKeyPattern =
  /^(courses|students|internships|scores|violations|shifts|certificates|grades:[A-Za-z0-9_-]{1,64}|attendance:[A-Za-z0-9_-]{1,64}\|\d{4}-\d{2}-\d{2}(?:\|[A-Za-z0-9_-]{1,64})?)$/;
const managerOnlyCollections = new Set([
  "students",
  "internships",
  "shifts",
  "certificates",
]);
const teacherCourseFields = [
  "attendanceMode",
  "attendanceMax",
  "attendanceAuto",
  "attendanceCap",
  "attendancePenalties",
  "attendancePercentages",
  "defaultSessionPoints",
  "passMark",
  "gradeWeights",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function findDocument(key: string): Promise<unknown | undefined> {
  const [document] = await db
    .select({ value: academyDocumentsTable.value })
    .from(academyDocumentsTable)
    .where(eq(academyDocumentsTable.key, key))
    .limit(1);
  return document?.value;
}

function canManage(user: AcademyPrincipal): boolean {
  return user.role === "quanly";
}

async function schoolDataFromStorage(): Promise<SchoolState> {
  await ensureAcademyInitialized();
  const documents = await db.select().from(academyDocumentsTable);
  const data: Record<string, unknown> = {
    courses: [],
    students: [],
    internships: [],
    shifts: [],
    examScores: [],
    violations: [],
    certificates: [],
    attendance: {},
    grades: {},
  };

  for (const document of documents) {
    switch (document.key) {
      case "courses":
      case "students":
      case "internships":
      case "shifts":
      case "violations":
      case "certificates":
        data[document.key] = document.value;
        break;
      case "scores":
        data["examScores"] = document.value;
        break;
      default:
        if (document.key.startsWith("grades:")) {
          (data["grades"] as Record<string, unknown>)[document.key.slice(7)] =
            document.value;
        } else if (document.key.startsWith("attendance:")) {
          (data["attendance"] as Record<string, unknown>)[document.key.slice(11)] =
            document.value;
        }
    }
  }

  stateDataSchema.parse(data);
  return data as unknown as SchoolState;
}

function validateCollection(key: string, value: unknown): unknown | null {
  const shape = stateDataSchema.shape;
  const schemas = {
    courses: shape.courses,
    students: shape.students,
    internships: shape.internships,
    shifts: shape.shifts,
    scores: shape.examScores,
    violations: shape.violations,
    certificates: shape.certificates,
  };

  if (collections.has(key)) {
    const schema = schemas[key as keyof typeof schemas];
    const result = schema.safeParse(value);
    return result?.success ? value : null;
  }
  if (key.startsWith("grades:")) {
    const result = shape.grades.safeParse({
      [key.slice(7)]: value,
    });
    if (!result.success) return null;
    return value;
  }
  if (key.startsWith("attendance:")) {
    const result = shape.attendance.safeParse({
      [key.slice(11)]: value,
    });
    if (!result.success) return null;
    return value;
  }
  return null;
}

function recordsById(value: unknown): Map<string, Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const entries = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item["id"] !== "string" ||
      item["id"].length === 0 ||
      item["id"].length > 64 ||
      entries.has(item["id"])
    ) {
      return null;
    }
    entries.set(item["id"], item);
  }
  return entries;
}

async function saveDocument(
  user: AcademyPrincipal,
  key: string,
  value: unknown,
): Promise<{ status: number; error?: string; rev?: number; saved?: unknown }> {
  if (!documentKeyPattern.test(key)) {
    return { status: 400, error: "Khoá dữ liệu không hợp lệ" };
  }

  let nextValue = validateCollection(key, value);
  if (nextValue === null) {
    return { status: 400, error: "Dữ liệu không đúng định dạng" };
  }
  if (key === "internships") {
    const records = recordsById(nextValue);
    if (!records) {
      return { status: 400, error: "Danh sách hồ sơ thực tập không hợp lệ" };
    }
    const nationalIds = new Set<string>();
    for (const record of records.values()) {
      const nationalId = String(record["nationalId"]).trim().toLocaleLowerCase();
      if (nationalIds.has(nationalId)) {
        return { status: 409, error: "Số CCCD đã được sử dụng trong danh sách thực tập" };
      }
      nationalIds.add(nationalId);
    }
  }

  if (managerOnlyCollections.has(key) && !canManage(user)) {
    return { status: 403, error: "Không đủ quyền" };
  }
  if (key === "scores" && user.role === "trogiang") {
    return { status: 403, error: "Trợ giảng không được nhập điểm thi" };
  }
  if (key === "courses" && user.role === "trogiang") {
    return { status: 403, error: "Trợ giảng không được sửa khoá học" };
  }

  const existingValue = await findDocument(key);
  if (key === "courses" && user.role === "giangvien") {
    const existingCourses = recordsById(existingValue);
    const requestedCourses = recordsById(nextValue);
    if (
      !existingCourses ||
      !requestedCourses ||
      existingCourses.size !== requestedCourses.size ||
      [...existingCourses.keys()].some((id) => !requestedCourses.has(id))
    ) {
      return { status: 403, error: "Giảng viên chỉ được cập nhật cách tính điểm khoá học" };
    }
    nextValue = [...existingCourses].map(([id, existingCourse]) => {
      const updatedCourse = { ...existingCourse };
      const requestedCourse = requestedCourses.get(id);
      if (requestedCourse) {
        for (const field of teacherCourseFields) {
          if (field in requestedCourse) {
            updatedCourse[field] = requestedCourse[field];
          }
        }
      }
      return updatedCourse;
    });
    const validated = validateCollection("courses", nextValue);
    if (validated === null) {
      return { status: 400, error: "Cấu hình tính điểm không hợp lệ" };
    }
    nextValue = validated;
  }

  if (
    (key === "scores" || key === "violations") &&
    !canManage(user) &&
    existingValue !== undefined
  ) {
    const previous = recordsById(existingValue);
    const requested = recordsById(nextValue);
    if (
      !previous ||
      !requested ||
      [...previous.keys()].some((id) => !requested.has(id))
    ) {
      return { status: 403, error: "Không được xoá bản ghi" };
    }
  }

  if (key.startsWith("grades:") && user.role === "trogiang") {
    const previous =
      isRecord(existingValue) ? existingValue : {};
    const requested = nextValue as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...previous };
    for (const [studentId, incoming] of Object.entries(requested)) {
      if (!isRecord(incoming) || typeof incoming["attendance"] !== "number") {
        continue;
      }
      const old = isRecord(previous[studentId]) ? previous[studentId] : {};
      merged[studentId] = { ...old, attendance: incoming["attendance"] };
    }
    nextValue = validateCollection(key, merged);
    if (nextValue === null) {
      return { status: 400, error: "Điểm chuyên cần không hợp lệ" };
    }
  }

  const persistedValue = nextValue as never;
  const rev = await db.transaction(async (tx) => {
    await tx
      .insert(academyDocumentsTable)
      .values({
        key,
        value: persistedValue,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: academyDocumentsTable.key,
        set: {
          value: persistedValue,
          updatedBy: user.id,
          updatedAt: new Date(),
        },
      });

    if (key.startsWith("attendance:")) {
      const courseId = key.slice(11).split("|")[0] ?? "";
      const storedCourses = await tx
        .select({ value: academyDocumentsTable.value })
        .from(academyDocumentsTable)
        .where(eq(academyDocumentsTable.key, "courses"))
        .limit(1);
      const courses = Array.isArray(storedCourses[0]?.value)
        ? storedCourses[0].value
        : [];
      const course = courses.find(
        (item): item is Record<string, unknown> =>
          isRecord(item) && item["id"] === courseId,
      );

      if (course?.["attendanceAuto"] === true) {
        const [studentsDocument] = await tx
          .select({ value: academyDocumentsTable.value })
          .from(academyDocumentsTable)
          .where(eq(academyDocumentsTable.key, "students"))
          .limit(1);
        const [attendanceDocuments, gradesDocument] = await Promise.all([
          tx
            .select({
              key: academyDocumentsTable.key,
              value: academyDocumentsTable.value,
            })
            .from(academyDocumentsTable)
            .where(
              sql`${academyDocumentsTable.key} LIKE ${`attendance:${courseId}|%`}`,
            ),
          tx
            .select({ value: academyDocumentsTable.value })
            .from(academyDocumentsTable)
            .where(eq(academyDocumentsTable.key, `grades:${courseId}`))
            .limit(1),
        ]);
        const students = Array.isArray(studentsDocument?.value)
          ? studentsDocument.value.filter(
              (item): item is Record<string, unknown> => isRecord(item),
            )
          : [];
        const currentGrades = isRecord(gradesDocument[0]?.value)
          ? gradesDocument[0].value
          : {};
        const sessions = attendanceDocuments
          .map((document) => document.value)
          .filter((item): item is Record<string, unknown> => isRecord(item));
        const maxPoints =
          typeof course["attendanceMax"] === "number"
            ? course["attendanceMax"]
            : 10;
        const cap =
          typeof course["attendanceCap"] === "number"
            ? Math.min(maxPoints, course["attendanceCap"])
            : maxPoints;
        const percentages = isRecord(course["attendancePercentages"])
          ? course["attendancePercentages"]
          : {};
        const penalties = isRecord(course["attendancePenalties"])
          ? course["attendancePenalties"]
          : {};
        const defaultPoints =
          typeof course["defaultSessionPoints"] === "number"
            ? course["defaultSessionPoints"]
            : 1;
        const revisedGrades: Record<string, unknown> = { ...currentGrades };

        for (const student of students) {
          const studentId = student["id"];
          if (typeof studentId !== "string") continue;
          let possible = 0;
          let earned = 0;
          for (const session of sessions) {
            const records = Array.isArray(session["records"])
              ? session["records"]
              : [];
            const record = records.find(
              (item): item is Record<string, unknown> =>
                isRecord(item) && item["studentId"] === studentId,
            );
            const points =
              typeof session["sessionPoints"] === "number"
                ? session["sessionPoints"]
                : defaultPoints;
            possible += points;
            const status =
              typeof record?.["status"] === "string"
                ? record["status"]
                : "unexcused";

            if (course["attendanceMode"] === "penalty") {
              const penalty =
                status === "present"
                  ? 0
                  : typeof penalties[status] === "number"
                    ? penalties[status]
                    : 0;
              earned += Math.max(0, points - penalty);
            } else {
              const percentage =
                typeof percentages[status] === "number"
                  ? percentages[status]
                  : 0;
              earned += points * (percentage / 100);
            }
          }

          const calculated =
            possible > 0 ? Math.min(cap, Math.max(0, (earned / possible) * maxPoints)) : 0;
          const previousGrade = isRecord(currentGrades[studentId])
            ? currentGrades[studentId]
            : {};
          revisedGrades[studentId] = {
            ...previousGrade,
            attendance: Math.round(calculated * 100) / 100,
          };
        }

        await tx
          .insert(academyDocumentsTable)
          .values({
            key: `grades:${courseId}`,
            value: revisedGrades as never,
            updatedBy: user.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: academyDocumentsTable.key,
            set: {
              value: revisedGrades as never,
              updatedBy: user.id,
              updatedAt: new Date(),
            },
          });
      }
    }

    const [revision] = await tx
      .update(academyMetaTable)
      .set({ value: sql`${academyMetaTable.value} + 1` })
      .where(eq(academyMetaTable.key, "revision"))
      .returning({ value: academyMetaTable.value });
    return revision?.value ?? 1;
  });

  return { status: 200, rev, saved: nextValue };
}

router.use(requireAcademyCsrf);

router.get("/state", requireAcademyAuth, async (_req, res): Promise<void> => {
  const user = academyUserFromResponse(res);
  const data = await schoolDataFromStorage();
  const [rev, users] = await Promise.all([
    getRevision(),
    canManage(user)
      ? db.select().from(academyUsersTable)
      : Promise.resolve([]),
  ]);

  const response = {
    me: user,
    rev,
    data: {
      ...data,
      internships: canManage(user) ? data.internships ?? [] : [],
    },
    users: users.map((item) => publicUser(item)),
  };
  GetSchoolStateResponse.parse(response);
  res.json(response);
});

router.get("/rev", requireAcademyAuth, async (_req, res): Promise<void> => {
  res.json(GetRevisionResponse.parse({ rev: await getRevision() }));
});

router.get("/dashboard", requireAcademyAuth, async (_req, res): Promise<void> => {
  const data = await schoolDataFromStorage();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const today =
    `${parts.find((part) => part.type === "year")?.value ?? ""}-` +
    `${parts.find((part) => part.type === "month")?.value ?? ""}-` +
    `${parts.find((part) => part.type === "day")?.value ?? ""}`;
  const absencesToday = Object.values(data.attendance)
    .filter(
      (session) =>
        (session.date instanceof Date
          ? session.date.toISOString()
          : String(session.date)
        ).slice(0, 10) === today,
    )
    .reduce(
      (count, session) =>
        count +
        session.records.filter(
          (record) => record.status === "excused" || record.status === "unexcused",
        ).length,
      0,
    );
  const recentViolations = [...data.violations]
    .sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime(),
    )
    .slice(0, 5);

  const response = {
    courseCount: data.courses.length,
    studentCount: data.students.length,
    absencesToday,
    violationCount: data.violations.length,
    certificateCount: data.certificates.filter((certificate) => !certificate.revoked)
      .length,
    recentViolations,
  };
  GetDashboardResponse.parse(response);
  res.json(response);
});

router.put("/doc", requireAcademyAuth, async (req, res): Promise<void> => {
  const body = SaveDocumentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Nội dung cần lưu không hợp lệ" });
    return;
  }
  const result = await saveDocument(
    academyUserFromResponse(res),
    body.data.key,
    body.data.value,
  );
  if (result.error) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(SaveDocumentResponse.parse({ rev: result.rev }));
});

router.delete("/doc", requireAcademyAuth, async (req, res): Promise<void> => {
  const query = DeleteDocumentQueryParams.safeParse(req.query);
  if (!query.success || !documentKeyPattern.test(query.data.key)) {
    res.status(400).json({ error: "Khoá dữ liệu không hợp lệ" });
    return;
  }
  if (!canManage(academyUserFromResponse(res))) {
    res.status(403).json({ error: "Chỉ Quản lý mới được xoá dữ liệu" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(academyDocumentsTable)
      .where(eq(academyDocumentsTable.key, query.data.key));
    const [revision] = await tx
      .update(academyMetaTable)
      .set({ value: sql`${academyMetaTable.value} + 1` })
      .where(eq(academyMetaTable.key, "revision"))
      .returning({ value: academyMetaTable.value });
    return revision?.value ?? 1;
  });
  res.status(204).end();
});

router.post("/restore", requireAcademyAuth, async (req, res): Promise<void> => {
  if (!canManage(academyUserFromResponse(res))) {
    res.status(403).json({ error: "Chỉ Quản lý mới được khôi phục dữ liệu" });
    return;
  }
  const parsed = RestoreBackupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "File sao lưu không hợp lệ" });
    return;
  }

  const bodyValue = req.body as Record<string, unknown>;
  const snapshot = bodyValue["snapshot"];
  const originalData =
    typeof snapshot === "object" && snapshot !== null
      ? (snapshot as Record<string, unknown>)["data"]
      : undefined;
  const data = stateDataSchema.safeParse(originalData);
  if (!data.success) {
    res.status(400).json({ error: "Dữ liệu trong file sao lưu không hợp lệ" });
    return;
  }
  const backupData = originalData as SchoolState;
  const actor = academyUserFromResponse(res);
  const entries: Array<{ key: string; value: unknown }> = [
    { key: "courses", value: backupData.courses },
    { key: "students", value: backupData.students },
    { key: "internships", value: backupData.internships ?? [] },
    { key: "shifts", value: backupData.shifts },
    { key: "scores", value: backupData.examScores },
    { key: "violations", value: backupData.violations },
    { key: "certificates", value: backupData.certificates },
    ...Object.entries(backupData.grades).map(([courseId, value]) => ({
      key: `grades:${courseId}`,
      value,
    })),
    ...Object.entries(backupData.attendance).map(([sessionKey, value]) => ({
      key: `attendance:${sessionKey}`,
      value,
    })),
  ];

  const rev = await db.transaction(async (tx) => {
    await tx.delete(academyDocumentsTable);
    await tx.insert(academyDocumentsTable).values(
      entries.map((entry) => ({
        ...entry,
        value: entry.value as never,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })),
    );
    const [revision] = await tx
      .update(academyMetaTable)
      .set({ value: sql`${academyMetaTable.value} + 1` })
      .where(eq(academyMetaTable.key, "revision"))
      .returning({ value: academyMetaTable.value });
    return revision?.value ?? 1;
  });
  res.json(RestoreBackupResponse.parse({ rev }));
});

export default router;
