export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** datetime-local (yerel saat) degerini ISO/UTC string'e cevirir. */
export function localInputToISO(value: string): string {
  // value: "2025-01-01T14:30" -> yerel saat kabul edilir
  return new Date(value).toISOString();
}

/** ISO/UTC string'i datetime-local input'una uygun yerel "YYYY-MM-DDTHH:mm"e cevirir. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

const TITLES = new Set(["dr", "prof", "doç", "doc", "öğr", "ogr", "gör", "gor", "arş", "ars", "üyesi", "uyesi"]);

/** Selamlama için ilk ad: unvanları (Dr., Prof., Öğr. Gör. …) atlar. */
export function firstName(full: string | null | undefined): string {
  const parts = (full ?? "").split(/\s+/).filter(Boolean);
  return parts.find((p) => !TITLES.has(p.replace(/\.$/, "").toLocaleLowerCase("tr"))) ?? "";
}

/** "PERŞEMBE, 24 EYLÜL" */
export function todayLabel(): string {
  return new Date()
    .toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" })
    .toLocaleUpperCase("tr");
}

/** Takvim rozeti: { day: "30", mon: "EYL" } */
export function dayMonth(iso: string): { day: string; mon: string } {
  const d = new Date(iso);
  return {
    day: String(d.getDate()),
    mon: d.toLocaleDateString("tr-TR", { month: "short" }).toLocaleUpperCase("tr").replace(".", ""),
  };
}

type Due ={ deadline_at: string; effective_deadline_at?: string | null };

/** Uzatmalar dahil geçerli son tarih (uzatma yoksa ödevin kendi tarihi). */
export function dueOf(a: Due): string {
  return a.effective_deadline_at ?? a.deadline_at;
}

/** Hoca teslimi uzattıysa true. */
export function isExtended(a: Due): boolean {
  return new Date(dueOf(a)).getTime() > new Date(a.deadline_at).getTime();
}

/** "30 Eyl 2026 23:59" ya da uzatıldıysa "… (uzatıldı: 3 Eki 2026 23:59)". */
export function dueLabel(a: Due): string {
  return isExtended(a)
    ? `${formatDate(a.deadline_at)} (uzatıldı: ${formatDate(dueOf(a))})`
    : formatDate(a.deadline_at);
}

/** "2 gün 4 sa", "5 sa", "12 dk" veya "Süre doldu". */
export function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Süre doldu";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} gün${hours ? ` ${hours} sa` : ""}`;
  if (hours > 0) return `${hours} sa${mins ? ` ${mins} dk` : ""}`;
  return `${mins} dk`;
}
