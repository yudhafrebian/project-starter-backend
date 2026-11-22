import request from "supertest";
import { app } from "../../src/app";
import { DEFAULT_PASSWORD } from "./db";

export const csrf = { "X-Requested-With": "XMLHttpRequest" };

export const agent = () => request.agent(app).set(csrf);

export const raw = () => request(app);

export const loginAs = async (email: string, password = DEFAULT_PASSWORD) => {
  const a = agent();
  const res = await a.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login gagal (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { agent: a, res };
};

export const getCookie = (res: request.Response, name: string): string | undefined => {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const found = cookies.find((c) => c.startsWith(`${name}=`));
  return found?.split(";")[0]?.slice(name.length + 1);
};
