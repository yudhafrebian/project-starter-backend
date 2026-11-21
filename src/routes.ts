import { Router } from "express";
import { requireCsrfHeader } from "./middlewares/csrf";
import { router as authRouter } from "../src/modules/auth/auth.routes";

export const api = Router();

api.use(requireCsrfHeader);
api.use("/auth", authRouter);
