import { Router, type IRouter } from "express";
import healthRouter from "./health";
import academyAuthRouter from "./academy-auth";
import academySchoolRouter from "./academy-school";
import academyUsersRouter from "./academy-users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(academyAuthRouter);
router.use(academySchoolRouter);
router.use(academyUsersRouter);

export default router;
