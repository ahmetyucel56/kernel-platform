import type { User } from "./api";

/** Reddit tarzı: içeriği sahibi veya moderatör (akademisyen/admin) silebilir. */
export function canModerate(
  user: User | null | undefined,
  ownerId: string | null | undefined
): boolean {
  if (!user) return false;
  return user.id === ownerId || user.role === "academician" || user.role === "admin";
}
