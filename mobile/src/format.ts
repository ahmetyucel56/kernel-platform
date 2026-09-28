/** Tarih/süre biçimleri — web'deki lib/format.ts ile aynı davranış. */

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 gün 4 sa", "5 sa 10 dk", "12 dk" veya "Süre doldu". */
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

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

type Due = { deadline_at: string; effective_deadline_at?: string | null };

/** Uzatmalar dahil geçerli son tarih (uzatma yoksa ödevin kendi tarihi). */
export function dueOf(a: Due): string {
  return a.effective_deadline_at ?? a.deadline_at;
}

export function isExtended(a: Due): boolean {
  return new Date(dueOf(a)).getTime() > new Date(a.deadline_at).getTime();
}

/** "30 Eyl 23:59" ya da uzatıldıysa "30 Eyl 23:59 (uzatıldı: 3 Eki 23:59)". */
export function dueLabel(a: Due): string {
  return isExtended(a)
    ? `${fmtDateTime(a.deadline_at)} (uzatıldı: ${fmtDateTime(dueOf(a))})`
    : fmtDateTime(a.deadline_at);
}

const TITLES = new Set(["dr", "prof", "doç", "doc", "öğr", "ogr", "gör", "gor", "arş", "ars", "üyesi", "uyesi"]);

/** Selamlama için ilk ad: unvanları (Dr., Prof., Öğr. Gör. …) atlar. */
export function firstName(full: string | null | undefined): string {
  const parts = (full ?? "").split(/\s+/).filter(Boolean);
  const name = parts.find((p) => !TITLES.has(p.replace(/\.$/, "").toLocaleLowerCase("tr")));
  return name ?? "";
}
