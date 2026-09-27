import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { db } from "./database";
import { sendEmail, emailTemplates, loadEmailBrand } from "../services/email";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    // Forgot-password flow: better-auth generates a one-time token and calls
    // this with a ready-to-use reset URL. We deliver it via the branded
    // Resend pipeline. Reset link expires in 1 hour.
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      // Brand every email with the tenant's own logo + name (Grab Brand Assets).
      const brand = await loadEmailBrand((user as { companyId?: string }).companyId);
      const tpl = emailTemplates.passwordReset({ name: user.name, url }, brand);
      await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: true,
      },
      phone: {
        type: "string",
        required: false,
        input: true,
      },
      // tenant the user belongs to — surfaced on the session so authMiddleware
      // can resolve the acting company (multi-tenancy). Not user-settable.
      companyId: {
        type: "string",
        required: false,
        defaultValue: "default",
        input: false,
      },
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin");
    return ["mobile://", "homeserve://", ...(origin ? [origin] : ["*"])];
  },
  plugins: [bearer(), expo()],
});
