import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateUserBody,
  CreateUserResponse,
  DeleteUserParams,
  ListUsersResponse,
  ResetUserPasswordParams,
  ResetUserPasswordBody,
  UpdateUserBody,
  UpdateUserParams,
  UpdateUserResponse,
} from "@workspace/api-zod";
import {
  academySessionsTable,
  academyUsersTable,
  db,
} from "@workspace/db";
import {
  bumpRevision,
  academyUserFromResponse,
  hashPassword,
  publicUser,
  requireAcademyAuth,
  requireAcademyCsrf,
  requireAcademyManager,
} from "../lib/academy";

const router: IRouter = Router();

router.use(requireAcademyCsrf, requireAcademyAuth, requireAcademyManager);

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(academyUsersTable);
  res.json(ListUsersResponse.parse({ users: users.map((user) => publicUser(user)) }));
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Thông tin tài khoản chưa hợp lệ" });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const [created] = await db
    .insert(academyUsersTable)
    .values({
      username,
      name: parsed.data.name.trim(),
      role: parsed.data.role,
      passwordHash: hashPassword(parsed.data.password),
      mustChangePassword: false,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
    return;
  }

  await bumpUserRevision();
  res.status(201).json(CreateUserResponse.parse(publicUser(created)));
});

router.patch("/users/:username", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  const body = UpdateUserBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Thông tin cập nhật chưa hợp lệ" });
    return;
  }

  const username = params.data.username.trim().toLowerCase();
  const [target] = await db
    .select()
    .from(academyUsersTable)
    .where(eq(academyUsersTable.username, username))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Không tìm thấy tài khoản" });
    return;
  }

  const actor = academyUserFromResponse(res);
  if (target.id === actor.id && body.data.role && body.data.role !== target.role) {
    res.status(400).json({ error: "Không thể tự thay đổi vai trò của mình" });
    return;
  }
  if (
    target.role === "quanly" &&
    body.data.role &&
    body.data.role !== "quanly" &&
    (await managerCount()) <= 1
  ) {
    res.status(400).json({ error: "Phải giữ lại ít nhất một tài khoản Quản lý" });
    return;
  }

  const updates: Partial<typeof academyUsersTable.$inferInsert> = {};
  if (body.data.name !== undefined) updates.name = body.data.name.trim();
  if (body.data.role !== undefined) updates.role = body.data.role;
  if (Object.keys(updates).length === 0) {
    res.json(UpdateUserResponse.parse(publicUser(target)));
    return;
  }

  const [updated] = await db
    .update(academyUsersTable)
    .set(updates)
    .where(eq(academyUsersTable.id, target.id))
    .returning();
  if (body.data.role && body.data.role !== target.role) {
    await db
      .delete(academySessionsTable)
      .where(eq(academySessionsTable.userId, target.id));
  }
  await bumpUserRevision();
  res.json(UpdateUserResponse.parse(publicUser(updated ?? target)));
});

router.delete("/users/:username", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Tên tài khoản không hợp lệ" });
    return;
  }
  const username = params.data.username.trim().toLowerCase();
  const [target] = await db
    .select()
    .from(academyUsersTable)
    .where(eq(academyUsersTable.username, username))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Không tìm thấy tài khoản" });
    return;
  }

  if (target.id === academyUserFromResponse(res).id) {
    res.status(400).json({ error: "Không thể xoá tài khoản đang đăng nhập" });
    return;
  }
  if (target.role === "quanly" && (await managerCount()) <= 1) {
    res.status(400).json({ error: "Phải giữ lại ít nhất một tài khoản Quản lý" });
    return;
  }

  await db.delete(academyUsersTable).where(eq(academyUsersTable.id, target.id));
  await bumpUserRevision();
  res.status(204).end();
});

router.post("/users/:username/password", async (req, res): Promise<void> => {
  const params = ResetUserPasswordParams.safeParse(req.params);
  const body = ResetUserPasswordBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Mật khẩu mới cần ít nhất 8 ký tự" });
    return;
  }
  const username = params.data.username.trim().toLowerCase();
  const [target] = await db
    .select({ id: academyUsersTable.id })
    .from(academyUsersTable)
    .where(eq(academyUsersTable.username, username))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Không tìm thấy tài khoản" });
    return;
  }
  if (target.id === academyUserFromResponse(res).id) {
    res.status(400).json({ error: "Dùng mục Đổi mật khẩu cho tài khoản đang đăng nhập" });
    return;
  }

  await db
    .update(academyUsersTable)
    .set({
      passwordHash: hashPassword(body.data.password),
      mustChangePassword: true,
    })
    .where(eq(academyUsersTable.id, target.id));
  await db
    .delete(academySessionsTable)
    .where(eq(academySessionsTable.userId, target.id));
  await bumpUserRevision();
  res.status(204).end();
});

async function managerCount(): Promise<number> {
  const managers = await db
    .select({ id: academyUsersTable.id })
    .from(academyUsersTable)
    .where(eq(academyUsersTable.role, "quanly"));
  return managers.length;
}

async function bumpUserRevision(): Promise<void> {
  await bumpRevision();
}

export default router;
