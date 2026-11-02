export type MemberRole = "owner" | "admin" | "barber";
export type Actor = {
  userId: string;
  businessId: string;
  role: MemberRole;
  aal: "aal1" | "aal2";
  active: boolean;
};
type Resource = {
  businessId: string;
  userId?: string | null;
  role?: MemberRole;
  nextRole?: MemberRole;
};

export function can(
  actor: Actor | null,
  action:
    | "business:enter"
    | "members:read"
    | "members:write"
    | "catalog:read"
    | "catalog:write"
    | "customers:read"
    | "customers:write"
    | "appointments:read"
    | "appointments:write",
  resource: Resource,
): boolean {
  if (!actor?.active || actor.businessId !== resource.businessId) return false;
  if (actor.role !== "barber" && actor.aal !== "aal2") return false;
  if (action === "business:enter" || action === "catalog:read") return true;
  if (actor.role === "barber") return false;
  if (
    action === "members:read" ||
    action === "catalog:write" ||
    action === "customers:read" ||
    action === "customers:write" ||
    action === "appointments:read" ||
    action === "appointments:write"
  )
    return true;
  if (action !== "members:write") return false;
  if (resource.userId === actor.userId) return false;
  return (
    actor.role === "owner" ||
    (resource.role === "barber" && resource.nextRole === "barber")
  );
}
