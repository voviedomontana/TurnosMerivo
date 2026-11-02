import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pathToFileURL } from "node:url";

// Interactive maintenance only. No passwords, tokens, or user details are printed.
export async function bootstrapLocalOwner(input) {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54321" ||
    !process.env.SUPABASE_AUTH_ADMIN_KEY
  )
    throw new Error();
  const slug = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
    .refine((s) => !["api", "app", "admin", "b"].includes(s))
    .parse(input.slug);
  const name = z.string().trim().min(1).max(200).parse(input.name);
  const email = z.email().max(254).parse(input.email);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_AUTH_ADMIN_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ).auth.admin;
  const { data, error } = await admin.inviteUserByEmail(email);
  if (error || !data.user) throw new Error();
  const userId = z.uuid().parse(data.user.id);
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_turnosmerivo",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `begin;
      do $$ declare v_business uuid; begin
        v_business:=app.create_business(${literal(slug)},${literal(name)});
        perform 1 from public.businesses where id=v_business for update;
        if exists(select 1 from public.business_members where business_id=v_business and role='owner' and status='active') then
          raise exception 'Owner already configured';
        end if;
        insert into public.business_members(business_id,user_id,role,status) values(v_business,'${userId}','owner','active');
      end $$; commit;`,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const slug = await prompt.question("Slug del negocio: ");
    const name = await prompt.question("Nombre del negocio: ");
    const email = await prompt.question("Email del primer propietario: ");
    await bootstrapLocalOwner({ slug, name, email });
    console.log(
      "Owner bootstrap completed locally. Open Mailpit at http://127.0.0.1:54324 and activate the account at /auth/alta; set a password and verify MFA.",
    );
  } catch {
    console.error(
      "Bootstrap not completed. Check input, local Auth, and whether an owner already exists. An Auth invite may have been sent; no existing owner is changed.",
    );
    process.exitCode = 1;
  } finally {
    prompt.close();
  }
}
