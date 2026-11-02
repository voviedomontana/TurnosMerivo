import "server-only";
import { redirect, notFound } from "next/navigation";
import { AccessError, getAal, getMe } from "./service";
import { can } from "./permissions";

export async function requirePageSession() {
  try {
    return { me: await getMe(), aal: await getAal() };
  } catch (error) {
    if (error instanceof AccessError && error.status === 401)
      redirect("/login");
    redirect("/login?unavailable=1");
  }
}
export async function requireBusinessPage(businessId: string) {
  const { me, aal } = await requirePageSession();
  const member = me.memberships.find((m) => m.business_id === businessId);
  if (!member) notFound();
  if (me.platform_admin && aal !== "aal2") redirect("/seguridad");
  if (
    !can(
      { userId: me.id, businessId, role: member.role, active: true, aal },
      "business:enter",
      { businessId },
    )
  )
    redirect("/seguridad");
  return { me, aal, member };
}
