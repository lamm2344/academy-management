import { useState } from "react";
import { CalendarPlus, Trash2 } from "lucide-react";
import type { Course, Shift } from "@workspace/api-client-react";

type CourseDay = Course["days"][number];
type EditableDay = CourseDay & { key: string };

type CourseFormProps = {
  course?: Course;
  shifts: Shift[];
  onCancel: () => void;
  onSubmit: (course: Omit<Course, "id">) => void;
};

const makeDayKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  `day-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function CourseForm({
  course,
  shifts,
  onCancel,
  onSubmit,
}: CourseFormProps) {
  const [name, setName] = useState(course?.name ?? "");
  const [startDate, setStartDate] = useState(course?.startDate?.slice(0, 10) ?? "");
  const [passMark, setPassMark] = useState(
    course?.passMark == null ? "5" : String(course.passMark),
  );
  const [attendanceMax, setAttendanceMax] = useState(
    String(course?.attendanceMax ?? 10),
  );
  const [attendanceMode, setAttendanceMode] = useState<Course["attendanceMode"]>(
    course?.attendanceMode ?? "session",
  );
  const [attendanceAuto, setAttendanceAuto] = useState(
    course?.attendanceAuto ?? true,
  );
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>(
    course?.shiftIds ?? [],
  );
  const [days, setDays] = useState<EditableDay[]>(
    (course?.days ?? []).map((day) => ({ ...day, key: makeDayKey() })),
  );
  const [error, setError] = useState("");

  const toggleCourseShift = (shiftId: string) => {
    const isSelected = selectedShiftIds.includes(shiftId);
    setSelectedShiftIds((current) =>
      isSelected
        ? current.filter((id) => id !== shiftId)
        : [...current, shiftId],
    );
    if (isSelected) {
      setDays((current) =>
        current.map((day) => ({
          ...day,
          shiftIds: day.shiftIds.filter((id) => id !== shiftId),
        })),
      );
    }
  };

  const toggleDayShift = (dayKey: string, shiftId: string) => {
    setSelectedShiftIds((current) =>
      current.includes(shiftId) ? current : [...current, shiftId],
    );
    setDays((current) =>
      current.map((day) => {
        if (day.key !== dayKey) return day;
        const selected = day.shiftIds.includes(shiftId);
        return {
          ...day,
          shiftIds: selected
            ? day.shiftIds.filter((id) => id !== shiftId)
            : [...day.shiftIds, shiftId],
        };
      }),
    );
  };

  const addDay = () =>
    setDays((current) => [
      ...current,
      {
        key: makeDayKey(),
        date: "",
        name: "",
        shiftIds: [...selectedShiftIds],
      },
    ]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datedDays = days.filter((day) => day.date.trim());
    const dates = datedDays.map((day) => day.date);
    if (new Set(dates).size !== dates.length) {
      setError("Mỗi ngày học chỉ nên xuất hiện một lần trong lịch khóa học.");
      return;
    }

    setError("");
    const savedDays: CourseDay[] = datedDays.map(
      ({ date, name: dayName, shiftIds }) => ({
        date,
        name: dayName?.trim() || null,
        shiftIds: shiftIds.filter((id) => selectedShiftIds.includes(id)),
      }),
    );

    onSubmit({
      name: name.trim(),
      startDate: startDate || null,
      shiftIds: selectedShiftIds,
      days: savedDays,
      attendanceMode,
      attendanceMax: Number(attendanceMax) || 10,
      attendanceAuto,
      attendanceCap: course?.attendanceCap ?? null,
      attendancePenalties: course?.attendancePenalties ?? {
        late: 0,
        excused: 0,
        unexcused: 0,
      },
      attendancePercentages: course?.attendancePercentages ?? {
        present: 100,
        late: 75,
        excused: 50,
        unexcused: 0,
      },
      defaultSessionPoints: course?.defaultSessionPoints ?? 1,
      passMark: passMark === "" ? null : Number(passMark),
      gradeWeights: course?.gradeWeights ?? {},
    });
  };

  return (
    <form className="form-stack course-form" onSubmit={submit}>
      <label className="field">
        <span>Tên khóa học</span>
        <input
          required
          maxLength={160}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ví dụ: Khóa đào tạo nghiệp vụ"
        />
      </label>

      <div className="course-form-grid">
        <label className="field">
          <span>Ngày khai giảng</span>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Điểm đạt</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={passMark}
            onChange={(event) => setPassMark(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Điểm chuyên cần tối đa</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={attendanceMax}
            onChange={(event) => setAttendanceMax(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Cách tính chuyên cần</span>
          <select
            value={attendanceMode}
            onChange={(event) =>
              setAttendanceMode(event.target.value as Course["attendanceMode"])
            }
          >
            <option value="session">Theo buổi học</option>
            <option value="penalty">Trừ điểm theo vi phạm</option>
            <option value="percentage">Theo tỷ lệ tham dự</option>
          </select>
        </label>
      </div>

      <section className="course-form-section">
        <div className="course-form-section-heading">
          <div>
            <b>Ca học của khóa</b>
            <p>Chọn các ca có thể xếp vào lịch khóa học.</p>
          </div>
        </div>
        {shifts.length ? (
          <div className="course-shift-options">
            {shifts.map((shift) => (
              <label className="course-shift-option" key={shift.id}>
                <input
                  type="checkbox"
                  checked={selectedShiftIds.includes(shift.id)}
                  onChange={() => toggleCourseShift(shift.id)}
                />
                <span>
                  <b>{shift.name}</b>
                  <small>
                    {shift.startTime}–{shift.endTime}
                  </small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="course-form-hint">
            Chưa có ca học. Hãy thêm ca học trước khi lập lịch.
          </p>
        )}
      </section>

      <section className="course-form-section">
        <div className="course-form-section-heading">
          <div>
            <b>Ngày học trong lịch</b>
            <p>
              {days.length
                ? `${days.length} ngày học đã cấu hình. Đặt tên và chọn ca riêng cho từng ngày.`
                : "Thêm ngày học, đặt tên từng ngày và chọn ca diễn ra trong ngày đó."}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={addDay}
          >
            <CalendarPlus size={14} />
            Thêm ngày
          </button>
        </div>

        {days.length ? (
          <div className="course-day-list">
            {days.map((day, index) => (
              <div className="course-day-editor" key={day.key}>
                <div className="course-day-editor-heading">
                  <b>Ngày học {index + 1}</b>
                  <button
                    type="button"
                    className="row-action danger-hover"
                    aria-label={`Xóa ngày học ${index + 1}`}
                    title="Xóa ngày học"
                    onClick={() =>
                      setDays((current) =>
                        current.filter((item) => item.key !== day.key),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="course-form-grid course-day-fields">
                  <label className="field">
                    <span>Ngày</span>
                    <input
                      type="date"
                      required
                      value={day.date}
                      onChange={(event) =>
                        setDays((current) =>
                          current.map((item) =>
                            item.key === day.key
                              ? { ...item, date: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Tên ngày học / nội dung</span>
                    <input
                      maxLength={120}
                      value={day.name ?? ""}
                      onChange={(event) =>
                        setDays((current) =>
                          current.map((item) =>
                            item.key === day.key
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Ví dụ: Khai giảng, Thực hành"
                    />
                  </label>
                </div>
                <div className="course-day-shifts">
                  <span className="course-day-shifts-label">Ca trong ngày</span>
                  {shifts.filter((shift) =>
                    selectedShiftIds.includes(shift.id),
                  ).length ? (
                    <div className="course-shift-options">
                      {shifts
                        .filter((shift) =>
                          selectedShiftIds.includes(shift.id),
                        )
                        .map((shift) => (
                          <label className="course-shift-option" key={shift.id}>
                            <input
                              type="checkbox"
                              checked={day.shiftIds.includes(shift.id)}
                              onChange={() =>
                                toggleDayShift(day.key, shift.id)
                              }
                            />
                            <span>
                              <b>{shift.name}</b>
                              <small>
                                {shift.startTime}–{shift.endTime}
                              </small>
                            </span>
                          </label>
                        ))}
                    </div>
                  ) : (
                    <p className="course-form-hint">
                      Chọn ca học của khóa để gán ca cho ngày này.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="course-day-empty">
            Chưa có ngày học. Dùng “Thêm ngày” để bắt đầu lập lịch.
          </div>
        )}
      </section>

      <label className="course-auto-attendance">
        <input
          type="checkbox"
          checked={attendanceAuto}
          onChange={(event) => setAttendanceAuto(event.target.checked)}
        />
        <span>
          <b>Tự động tính điểm chuyên cần</b>
          <small>Cập nhật điểm chuyên cần từ các buổi đã điểm danh.</small>
        </span>
      </label>

      {error && <p className="course-form-error" role="alert">{error}</p>}

      <div className="modal-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
        >
          Hủy
        </button>
        <button type="submit" className="button button-primary">
          Lưu khóa học
        </button>
      </div>
    </form>
  );
}
