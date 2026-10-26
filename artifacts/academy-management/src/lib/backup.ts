import type {
  AttendanceRecord,
  AttendanceSession,
  Certificate,
  Course,
  ExamScore,
  GradeValues,
  Internship,
  RestoreInput,
  SchoolState,
  Shift,
  Student,
  Violation,
} from "@workspace/api-client-react";

type Dict = Record<string, unknown>;

const asRecord = (value: unknown): Dict | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Dict)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const day = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 10) return "";
  return value.slice(0, 10);
};

const stringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

function normalizeInternships(values: unknown[]): Internship[] {
  const validStatuses: Internship["status"][] = [
    "Đang thực tập",
    "Đã hoàn thành",
    "Tạm dừng",
  ];

  return values.flatMap((value, index) => {
    const item = asRecord(value);
    if (!item) return [];
    const name = text(item["name"]);
    const nationalId = text(item["nationalId"] ?? item["cccd"]);
    if (!name || !nationalId) return [];
    const status = text(item["status"]) as Internship["status"];

    return [
      {
        id: text(item["id"], `internship_${index + 1}`),
        name,
        nationalId,
        position: text(item["position"]),
        militaryRank: text(item["militaryRank"]),
        status: validStatuses.includes(status) ? status : "Đang thực tập",
      },
    ];
  });
}

function normalizeShifts(values: unknown[]): Shift[] {
  return values.map((value, index) => {
    const item = asRecord(value) ?? {};
    return {
      id: text(item["id"], `shift_${index + 1}`),
      name: text(item["name"], `Ca ${index + 1}`),
      startTime: text(item["startTime"] ?? item["start"], "08:00"),
      endTime: text(item["endTime"] ?? item["end"], "12:00"),
    };
  });
}

function normalizeCourse(value: unknown, index: number, fallbackShift: string): Course {
  const item = asRecord(value) ?? {};
  const weights = asRecord(item["gradeWeights"] ?? item["w"]) ?? {};
  const penalties = asRecord(
    item["attendancePenalties"] ?? item["pen"],
  ) ?? {};
  const percentages = asRecord(
    item["attendancePercentages"] ?? item["sp"],
  ) ?? {};
  const rawMode = item["attendanceMode"] ?? item["cm"];
  const attendanceMode =
    rawMode === "penalty" || rawMode === "pen"
      ? "penalty"
      : rawMode === "percentage" || rawMode === "pct"
        ? "percentage"
        : "session";
  const legacyShiftIds = stringList(item["shiftIds"] ?? item["shifts"] ?? item["shift"]);
  const days = asArray(item["days"]).flatMap((rawDay) => {
    const dayItem = asRecord(rawDay);
    if (!dayItem) return [];
    const date = day(dayItem["date"] ?? dayItem["d"]);
    if (!date) return [];
    const shiftIds = stringList(dayItem["shiftIds"] ?? dayItem["shifts"] ?? dayItem["sh"]);
    return [
      {
        date,
        name:
          typeof dayItem["name"] === "string"
            ? dayItem["name"]
            : typeof dayItem["title"] === "string"
              ? dayItem["title"]
              : null,
        shiftIds: shiftIds.length ? shiftIds : legacyShiftIds,
      },
    ];
  });

  return {
    id: text(item["id"], `course_${index + 1}`),
    name: text(item["name"], `Khóa học ${index + 1}`),
    startDate: day(item["startDate"] ?? item["start"]) || null,
    shiftIds: legacyShiftIds.length ? legacyShiftIds : [fallbackShift],
    days,
    attendanceMode,
    attendanceMax: Math.max(0, number(item["attendanceMax"] ?? item["cmax"], 10)),
    attendanceAuto: Boolean(item["attendanceAuto"] ?? item["cauto"] ?? true),
    attendanceCap:
      item["attendanceCap"] === null || item["ccap"] === null
        ? null
        : typeof (item["attendanceCap"] ?? item["ccap"]) === "number"
          ? number(item["attendanceCap"] ?? item["ccap"])
          : null,
    attendancePenalties: {
      late: Math.max(0, number(penalties["late"] ?? penalties["L"])),
      excused: Math.max(0, number(penalties["excused"] ?? penalties["E"])),
      unexcused: Math.max(0, number(penalties["unexcused"] ?? penalties["A"])),
    },
    attendancePercentages: {
      present: Math.min(100, Math.max(0, number(percentages["present"] ?? percentages["P"], 100))),
      late: Math.min(100, Math.max(0, number(percentages["late"] ?? percentages["L"], 50))),
      excused: Math.min(100, Math.max(0, number(percentages["excused"] ?? percentages["E"]))),
      unexcused: Math.min(100, Math.max(0, number(percentages["unexcused"] ?? percentages["A"]))),
    },
    defaultSessionPoints: Math.max(
      0,
      number(item["defaultSessionPoints"] ?? item["spt"], 1),
    ),
    passMark:
      typeof (item["passMark"] ?? item["pass"]) === "number"
        ? number(item["passMark"] ?? item["pass"])
        : null,
    gradeWeights: {
      attendance: Math.max(0, number(weights["attendance"] ?? weights["cc"], 1)),
      group: Math.max(0, number(weights["group"] ?? weights["hn"], 1)),
      bonus: Math.max(0, number(weights["bonus"] ?? weights["dc"], 1)),
      evaluation: Math.max(0, number(weights["evaluation"] ?? weights["dg"], 1)),
      round1: Math.max(0, number(weights["round1"] ?? weights["v1"], 1)),
      round2: Math.max(0, number(weights["round2"] ?? weights["v2"], 1)),
      round3: Math.max(0, number(weights["round3"] ?? weights["v3"], 1)),
      round4: Math.max(0, number(weights["round4"] ?? weights["v4"], 1)),
    },
  };
}

function normalizeStudents(values: unknown[], fallbackCourse: string): Student[] {
  return values.map((value, index) => {
    const item = asRecord(value) ?? {};
    const id = text(item["id"], `student_${index + 1}`);
    return {
      id,
      courseId: text(item["courseId"] ?? item["course"], fallbackCourse),
      name: text(item["name"], `Học viên ${index + 1}`),
      nationalId: text(item["nationalId"] ?? item["cccd"] ?? item["code"], id),
      force: text(item["force"]),
    };
  });
}

function normalizeScores(values: unknown[]): ExamScore[] {
  return values.map((value, index) => {
    const item = asRecord(value) ?? {};
    return {
      id: text(item["id"], `score_${index + 1}`),
      studentId: text(item["studentId"] ?? item["sid"]),
      exam: text(item["exam"], "Bài đánh giá"),
      point: Math.min(10, Math.max(0, number(item["point"] ?? item["pt"]))),
      date: day(item["date"]) || new Date().toISOString().slice(0, 10),
      note: text(item["note"]),
      by: text(item["by"]),
    };
  });
}

function normalizeViolations(values: unknown[]): Violation[] {
  return values.map((value, index) => {
    const item = asRecord(value) ?? {};
    return {
      id: text(item["id"], `violation_${index + 1}`),
      studentId: text(item["studentId"] ?? item["sid"]),
      type: text(item["type"], "Vi phạm"),
      date: day(item["date"]) || new Date().toISOString().slice(0, 10),
      note: text(item["note"]),
      by: text(item["by"]),
    };
  });
}

function normalizeCertificates(values: unknown[]): Certificate[] {
  return values.map((value, index) => {
    const item = asRecord(value) ?? {};
    return {
      id: text(item["id"], `certificate_${index + 1}`),
      number: text(item["number"] ?? item["no"], `CERT-${index + 1}`),
      studentId: text(item["studentId"] ?? item["sid"]),
      type: text(item["type"], "Chứng nhận hoàn thành khóa học"),
      rank: text(item["rank"]),
      unit: text(item["unit"]),
      grade: text(item["grade"]),
      date: day(item["date"]) || new Date().toISOString().slice(0, 10),
      expiresAt: day(item["expiresAt"]) || null,
      note: text(item["note"]),
      revoked: Boolean(item["revoked"]),
      by: text(item["by"]),
    };
  });
}

function normalizeGrades(value: unknown): SchoolState["grades"] {
  const grades = asRecord(value) ?? {};
  return Object.fromEntries(
    Object.entries(grades).map(([courseId, rawRows]) => {
      const rows = asRecord(rawRows) ?? {};
      const normalized: Record<string, GradeValues> = {};
      for (const [studentId, rawGrade] of Object.entries(rows)) {
        const grade = asRecord(rawGrade) ?? {};
        normalized[studentId] = {
          attendance: (grade["attendance"] ?? grade["cc"] ?? null) as number | null,
          group: (grade["group"] ?? grade["hn"] ?? null) as number | null,
          bonus: (grade["bonus"] ?? grade["dc"] ?? null) as number | null,
          evaluation: (grade["evaluation"] ?? grade["dg"] ?? null) as number | null,
          round1: (grade["round1"] ?? grade["v1"] ?? null) as number | null,
          round2: (grade["round2"] ?? grade["v2"] ?? null) as number | null,
          round3: (grade["round3"] ?? grade["v3"] ?? null) as number | null,
          round4: (grade["round4"] ?? grade["v4"] ?? null) as number | null,
        };
      }
      return [courseId, normalized];
    }),
  );
}

function normalizeStatus(value: unknown): AttendanceRecord["status"] {
  if (value === "present" || value === "P") return "present";
  if (value === "late" || value === "L") return "late";
  if (value === "excused" || value === "E") return "excused";
  return "unexcused";
}

function normalizeAttendance(value: unknown): SchoolState["attendance"] {
  const sessions = asRecord(value) ?? {};
  const result: Record<string, AttendanceSession> = {};

  for (const [rawKey, rawSession] of Object.entries(sessions)) {
    const item = asRecord(rawSession);
    if (!item) continue;
    const key = rawKey.replace(/^attendance:/, "");
    const [keyCourse, keyDate, keyShift] = key.split("|");
    const courseId = text(item["courseId"], keyCourse);
    const date = day(item["date"] ?? item["day"] ?? keyDate);
    if (!courseId || !date) continue;
    const records: AttendanceRecord[] = Array.isArray(item["records"])
      ? asArray(item["records"]).flatMap((rawRecord) => {
          const record = asRecord(rawRecord);
          if (!record) return [];
          return [
            {
              studentId: text(record["studentId"] ?? record["sid"]),
              status: normalizeStatus(record["status"] ?? record["s"]),
              note: text(record["note"] ?? record["n"]),
            },
          ];
        })
      : Object.entries(item).flatMap(([studentId, rawRecord]) => {
          if (studentId.startsWith("_")) return [];
          const record = asRecord(rawRecord);
          if (!record) return [];
          return [
            {
              studentId,
              status: normalizeStatus(record["status"] ?? record["s"]),
              note: text(record["note"] ?? record["n"]),
            },
          ];
        });
    const shiftId = text(item["shiftId"], keyShift || "sh_morning");
    result[`${courseId}|${date}|${shiftId}`] = {
      courseId,
      date,
      shiftId,
      instructor: text(item["instructor"] ?? item["_gv"]),
      assistant: text(item["assistant"] ?? item["_ta"]),
      sessionPoints: Math.max(0, number(item["sessionPoints"] ?? item["_p"], 1)),
      records,
    };
  }
  return result;
}

export function normalizeBackupSnapshot(input: unknown): RestoreInput["snapshot"] | null {
  const root = asRecord(input);
  if (!root) return null;
  const snapshot = asRecord(root["snapshot"]) ?? root;
  const rawData = asRecord(snapshot["data"]) ?? snapshot;
  if (!Array.isArray(rawData["courses"])) return null;

  const shifts = normalizeShifts(asArray(rawData["shifts"]));
  const fallbackShift = shifts[0]?.id ?? "sh_morning";
  const courses = asArray(rawData["courses"]).map((value, index) =>
    normalizeCourse(value, index, fallbackShift),
  );
  const fallbackCourse = courses[0]?.id ?? "";
  const data: SchoolState = {
    courses,
    students: normalizeStudents(asArray(rawData["students"]), fallbackCourse),
    internships: normalizeInternships(asArray(rawData["internships"])),
    shifts,
    examScores: normalizeScores(asArray(rawData["examScores"] ?? rawData["scores"])),
    violations: normalizeViolations(
      asArray(rawData["violations"] ?? rawData["viol"]),
    ),
    certificates: normalizeCertificates(
      asArray(rawData["certificates"] ?? rawData["certs"]),
    ),
    attendance: normalizeAttendance(rawData["attendance"] ?? rawData["att"]),
    grades: normalizeGrades(rawData["grades"]),
  };

  return {
    version: typeof snapshot["version"] === "number" ? snapshot["version"] : 1,
    exportedAt:
      typeof snapshot["exportedAt"] === "string"
        ? snapshot["exportedAt"]
        : new Date().toISOString(),
    data,
  };
}
