import { AccessShell } from "@/components/auth/shell";
import { requirePageSession } from "@/modules/auth/page-session";
export const dynamic = "force-dynamic";
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageSession();
  return <AccessShell signedIn>{children}</AccessShell>;
}
