import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import "./db";
import { ApiError } from "./errors";
import archivesRouter from "./routes/archives";
import cronTasksRouter from "./routes/cronTasks";
import departmentsRouter from "./routes/departments";
import employeesRouter from "./routes/employees";
import experiencesRouter from "./routes/experience";
import groupsRouter from "./routes/groups";
import migrateRouter from "./routes/migrate";
import settingsRouter from "./routes/settings";
import storageRouter from "./routes/storage";
import { startReviewScheduler } from "./services/reviewService";

const app = express();
const port = Number(process.env.PORT ?? 3001);

function isAllowedOrigin(origin: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);
}

app.use((req, res, next) => {
  res.on("finish", () => {
    console.log(`[API] ${req.method} ${req.originalUrl} - ${res.statusCode}`);
  });

  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new ApiError(403, `不允许的来源: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(
  express.json({
    limit: "10mb",
  }),
);

app.use("/api/employees", employeesRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/experience", experiencesRouter);
app.use("/api/archives", archivesRouter);
app.use("/api/cron-tasks", cronTasksRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/migrate", migrateRouter);
app.use("/api/storage", storageRouter);

app.use((req, _res, next) => {
  next(new ApiError(404, `接口不存在: ${req.method} ${req.originalUrl}`));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  let statusCode = 500;
  let message = "服务器内部错误";

  if (error instanceof ApiError) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error instanceof SyntaxError) {
    statusCode = 400;
    message = "请求体不是合法 JSON";
  } else if (error instanceof Error && error.message.trim()) {
    message = error.message;
  }

  if (statusCode >= 500) {
    console.error("[API] 未处理错误:", error);
  }

  res.status(statusCode).json({
    error: message,
  });
});

app.listen(port, () => {
  console.log(`[API] 后端已启动: http://localhost:${port}`);
  startReviewScheduler();
});
