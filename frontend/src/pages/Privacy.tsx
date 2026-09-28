import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from "../lib/privacy";

type Meta = { controller: string; contact: string | null };

/** KVKK aydınlatma metni (herkese açık: /aydinlatma). */
export function Privacy() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api<Meta>("/meta/privacy", { auth: false }).then(setMeta).catch(() => {});
  }, []);

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 40, paddingBottom: 60 }}>
      <h1 className="h-page">Kişisel verilerin korunması</h1>
      <p className="muted" style={{ marginTop: -4 }}>KVKK aydınlatma metni · Son güncelleme: {PRIVACY_UPDATED}</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>Veri sorumlusu</span>
          <b style={{ textAlign: "right" }}>{meta?.controller ?? "…"}</b>
        </div>
        <hr style={{ margin: "12px 0" }} />
        <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>Başvuru ve sorular</span>
          {meta?.contact ? <a href={`mailto:${meta.contact}`}>{meta.contact}</a> : <span className="muted">Hocan veya okulun aracılığıyla</span>}
        </div>
      </div>

      {PRIVACY_SECTIONS.map((s) => (
        <section key={s.title} style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>{s.title}</h2>
          {s.paragraphs?.map((p, i) => (
            <p key={i} style={{ lineHeight: 1.6 }}>{p}</p>
          ))}
          {s.bullets && (
            <ul style={{ paddingLeft: 20, lineHeight: 1.6, margin: 0 }}>
              {s.bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <p className="muted" style={{ marginTop: 26, fontSize: 13.5 }}>
        Haklarını kullanmak için yukarıdaki iletişim adresine yazabilirsin. Başvurular en geç 30 gün içinde
        yanıtlanır.
      </p>
    </div>
  );
}
