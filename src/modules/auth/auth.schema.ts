import z from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const newPasswordSchema = z
  .string()
  .min(12, "password_too_short")
  .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "password_too_long");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: newPasswordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(256),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: newPasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "password_same_as_current",
    path: ["newPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(256),
  newPassword: newPasswordSchema,
});

export const googleLoginSchema = z.object({
  credential: z.string().min(1).max(4096),
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .nullable()
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.avatarUrl !== undefined, {
    message: "at_least_one_field_required",
  });
