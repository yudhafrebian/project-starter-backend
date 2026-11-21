import z from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z
      .string()
      .min(12, "password_too_short")
      .max(256),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "password_same_as_current",
    path: ["newPassword"],
  });
