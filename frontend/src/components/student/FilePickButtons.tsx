import { useRef } from "react";

// Sunucu da atlar; tarayıcıda baştan eleyince gereksiz binlerce dosya yüklenmez.
const SKIP_DIRS = new Set(["node_modules", "__pycache__", ".git", ".venv", "venv", "__MACOSX", ".idea", ".vscode", "dist", "build"]);
const MAX_BYTES = 20 * 1024 * 1024;

/** Seçilen dosyalardan yükleme formu: tek .zip -> "file"; diğerleri (dosya/klasör) -> "files"
 *  (klasörde göreli yol korunur, sunucu ZIP'e paketler). Hata varsa mesaj döner. */
export function buildUploadForm(list: File[]): FormData | string {
  const files = list.filter((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    return !rel.split("/").some((p) => SKIP_DIRS.has(p));
  });
  if (files.length === 0) return "Yüklenecek dosya bulunamadı.";
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES) return "Dosyalar toplamda en fazla 20 MB olabilir.";
  const form = new FormData();
  if (files.length === 1 && files[0].name.toLowerCase().endsWith(".zip")) {
    form.append("file", files[0]);
  } else {
    for (const f of files) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      form.append("files", f, rel);
    }
  }
  return form;
}

/** "Dosya seç" (bir veya birden fazla dosya, .zip dahil) + "Klasör seç". */
export function FilePickButtons({
  label,
  disabled,
  busy,
  onPick,
  primary = true,
  small = false,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onPick: (files: File[]) => void;
  primary?: boolean;
  small?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const off = disabled || busy;
  const style = {
    cursor: off ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    ...(small ? { padding: "6px 12px", fontSize: 13 } : {}),
  } as const;

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length) onPick(list);
  }

  return (
    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <label className={primary ? "btn btn-gold" : "btn"} style={style} title="Bir veya birden fazla dosya ya da .zip seç">
        {busy ? "Yükleniyor…" : label}
        <input ref={fileRef} type="file" multiple onChange={handle} disabled={off} style={{ display: "none" }} />
      </label>
      <label className="btn btn-ghost" style={style} title="Proje klasörünü olduğu gibi seç">
        Klasör seç
        <input
          ref={dirRef}
          type="file"
          multiple
          onChange={handle}
          disabled={off}
          style={{ display: "none" }}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
      </label>
    </span>
  );
}
