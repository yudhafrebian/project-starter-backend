import { compare, genSalt, hash } from "bcryptjs";

export const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 12;

export const hashPassword = async (password: string) => {
  const salt = await genSalt(BCRYPT_COST);
  return await hash(password, salt);
};

export const verifyPassword = async (password: string, hash: string) => {
  return await compare(password, hash);
};
