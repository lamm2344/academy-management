import { Router, type IRouter } from "express";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import {
  academySessionsTable,
  academyUsersTable,
  db,
} from "@workspace/db";
import {
  ChangePasswordBody,
  GetSessionResponse,
  LoginBody,
  LoginResponse,
} from "@workspace/api-zod";
import {
  academySessionHashFromResponse,
  academyUserFromResponse,
  clearSessionCookie,
  ensureAcademyInitialized,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  parseCookies,
  publicUser,
  requireAcademyAuth,
  requireAcademyCsrf,
  setSessionCookie,
  SESSION_TTL_MS,
  verifyPassword,
} from "../lib/academy";

const router: IRouter = Router();
const loginFailures = new Map<string, { count: number; firstFailureAt: number }>();
const SESSION_COOKIE = "academy.sid";

router.use(requireAcademyCsrf);

router.get("/auth/session", async (req, res): Promise<void> => {
  await ensureAcademyInitialized();
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  let user = null;

  if (token) {
    const [session] = await db
      .select({ session: academySessionsTable, user: academyUsersTable })
      .from(academySessionsTable)
      .innerJoin(
        academyUsersTable,
        eq(academySessionsTable.userId, academyUsersTable.id),
      )
      .where(
        and(
          eq(academySessionsTable.tokenHash, hashSessionToken(token)),
          gt(academySessionsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (session) user = publicUser(session.user);
  }

  const [admin] = await db
    .select({ mustChangePassword: academyUsersTable.mustChangePassword })
    .from(academyUsersTable)
    .where(eq(academyUsersTable.username, "admin"))
    .limit(1);

  res.json(
    GetSessionResponse.parse({
      user,
      defaultAdmin: admin?.mustChangePassword ?? false,
    }),
  );
});

router.post("/login", async (req, res): Promise<void> => {
  await ensureAcademyInitialized();
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Vui lòng nhập tài khoản và mật khẩu hợp lệ" });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const failureKey = `${req.ip ?? "unknown"}|${username}`;
  const previous = loginFailures.get(failureKey);
  if (
    previous &&
    previous.count >= 8 &&
    Date.now() - previous.firstFailureAt < 10 * 60 * 1000
  ) {
    res.status(429).json({ error: "Thử sai quá nhiều lần, vui lòng đợi vài phút" });
    return;
  }

  const [user] = await db
    .select()
    .from(academyUsersTable)
    .where(eq(academyUsersTable.username, username))
    .limit(1);
  const passwordMatches =
    !!user && verifyPassword(username, parsed.data.password, user.passwordHash);

  if (!user || !passwordMatches) {
    const now = Date.now();
    if (!previous || now - previous.firstFailureAt >= 10 * 60 * 1000) {
      loginFailures.set(failureKey, { count: 1, firstFailureAt: now });
    } else {
      loginFailures.set(failureKey, {
        ...previous,
        count: previous.count + 1,
      });
    }
    res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
    return;
  }

  loginFailures.delete(failureKey);
  if (user.passwordHash.startsWith("legacy:")) {
    await db
      .update(academyUsersTable)
      .set({ passwordHash: hashPassword(parsed.data.password) })
      .where(eq(academyUsersTable.id, user.id));
  }

  await db
    .delete(academySessionsTable)
    .where(lt(academySessionsTable.expiresAt, new Date()));
  const token = newSessionToken();
  await db.insert(academySessionsTable).values({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  setSessionCookie(res, token);
  res.json(
    LoginResponse.parse({
      user: publicUser(user),
      defaultAdmin: user.username === "admin" && user.mustChangePassword,
    }),
  );
});

router.post("/logout", async (req, res): Promise<void> => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    await db
      .delete(academySessionsTable)
      .where(eq(academySessionsTable.tokenHash, hashSessionToken(token)));
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.post("/password", requireAcademyAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Mật khẩu mới cần ít nhất 8 ký tự" });
    return;
  }
  const user = academyUserFromResponse(res);
  const currentHash = academySessionHashFromResponse(res);
  await db
    .update(academyUsersTable)
    .set({
      passwordHash: hashPassword(parsed.data.password),
      mustChangePassword: false,
    })
    .where(eq(academyUsersTable.id, user.id));
  await db
    .delete(academySessionsTable)
    .where(
      and(
        eq(academySessionsTable.userId, user.id),
        ne(academySessionsTable.tokenHash, currentHash),
      ),
    );
  res.status(204).end();
});

export default router;
