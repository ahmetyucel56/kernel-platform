import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND_NAME } from "../config";
import { useAuth, useDemoEnabled } from "../auth/AuthContext";
import { DemoButtons } from "../components/DemoButtons";
import { IconAlert, IconCheck, IconSparkle } from "../components/icons";
import "../styles/landing.css";

/** Scroll ile görünür olunca beliren sarmalayıcı (IntersectionObserver). */
function Reveal({ children, className = "", delay = "" }: { children: ReactNode; className?: string; delay?: "" | "d1" | "d2" | "d3" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          ob.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${delay} ${inView ? "in" : ""} ${className}`}>
      {children}
    </div>
  );
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Landing() {
  const { user } = useAuth();
  const demo = useDemoEnabled();

  const primaryCta = user ? (
    <Link className="btn btn-gold" to="/panel">Panele git</Link>
  ) : demo ? (
    <DemoButtons />
  ) : (
    <Link className="btn btn-gold" to="/giris">Giriş yap</Link>
  );

  return (
    <div className="lp container">
      <div className="lp-aurora" aria-hidden>
        <span className="a1" />
        <span className="a2" />
      </div>

      {/* ---------- GİRİŞ ---------- */}
      <section className="lp-hero">
        <div className="lp-hero-grid">
          <Reveal>
            <span className="lp-eyebrow">
              <span className="lp-dot" /> Programlama dersleri için ödev ve kod inceleme
            </span>
            <h1 className="h-hero lp-title">
              Her ödevi <span className="accent">kural kural</span> değerlendir, öğrenciye{" "}
              <span className="accent">zamanında</span> geri bildirim ver.
            </h1>
            <p className="lp-lead">
              Öğrenci projesini yükler. {BRAND_NAME}, hocanın yazdığı her kuralın kodda karşılanıp
              karşılanmadığını <b>kanıtıyla</b> gösterir; kod kalitesini ve kopya riskini raporlar.
              Yapay zeka yalnızca hoca istediğinde çalışır, <b>notu her zaman hoca verir</b>.
            </p>
            <div className="lp-cta-row">
              {primaryCta}
              <button className="btn btn-ghost" onClick={() => scrollTo("yolculuk")}>
                Nasıl çalışır?
              </button>
            </div>
            {!user && demo && (
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
                Hesabın var mı? <Link to="/giris">Giriş yap</Link>
              </p>
            )}
          </Reveal>

          <Reveal delay="d1">
            <RequirementMock />
          </Reveal>
        </div>
      </section>

      {/* ---------- SORUN → ÇÖZÜM ---------- */}
      <section className="lp-section" id="neden">
        <Reveal>
          <div className="lp-kicker">Neden {BRAND_NAME}?</div>
          <h2 className="lp-h2">Ödev değerlendirmenin en yorucu kısımlarını üstlenir</h2>
        </Reveal>
        <div className="lp-compare">
          {PROBLEMS.map((p, i) => (
            <Reveal key={p.before} delay={(["", "d1", "d2", "d3"][i % 4] as "" | "d1" | "d2" | "d3")}>
              <div className="lp-pair">
                <div className="lp-before">
                  <span className="lp-tag-muted">Bugün</span>
                  <p>{p.before}</p>
                </div>
                <div className="lp-after">
                  <span className="lp-tag-gold">{BRAND_NAME} ile</span>
                  <p>{p.after}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- BİR ÖDEVİN YOLCULUĞU ---------- */}
      <section className="lp-section" id="yolculuk">
        <Reveal>
          <div className="lp-kicker">Nasıl çalışır?</div>
          <h2 className="lp-h2">Bir ödevin baştan sona yolculuğu</h2>
          <p className="muted lp-sub">Her adımda kimin ne yaptığı açık: hoca, öğrenci ve yapay zeka.</p>
        </Reveal>
        <ol className="lp-timeline">
          {JOURNEY.map((s, i) => (
            <Reveal key={s.title} delay={(["", "d1", "d2"][i % 3] as "" | "d1" | "d2")}>
              <li className="lp-tl-item">
                <div className="lp-tl-no">{i + 1}</div>
                <div className="lp-tl-body">
                  <span className={`lp-role lp-role-${s.who}`}>{ROLE_LABEL[s.who]}</span>
                  <h3>{s.title}</h3>
                  <p className="muted">{s.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ---------- EKRANLAR ---------- */}
      <section className="lp-section" id="ozellikler">
        <Reveal>
          <div className="lp-kicker">Uygulamadan</div>
          <h2 className="lp-h2">Ekranda gördüklerin</h2>
          <p className="muted lp-sub">Aşağıdakiler uygulamadaki ekranların sadeleştirilmiş hâlidir.</p>
        </Reveal>
        <div className="lp-showcase">
          <Reveal>
            <Showcase
              title="Hoca: bugün neye bakmalıyım?"
              body="Panoda notlanmayı bekleyen teslimler, bu hafta biten ödevler, yüksek benzerlik ve teslim etmeyenler tek bakışta. Tıklayınca ilgili ödev açılır."
            >
              <div className="lp-mini-stats">
                <MiniStat k="Notlanmayı bekleyen" v="4" s="teslim" />
                <MiniStat k="Bu hafta bitiyor" v="1" s="ödev" />
                <MiniStat k="Benzerlik uyarısı" v="1" s="çift" warn />
                <MiniStat k="Eksik teslim" v="4" s="teslim" />
              </div>
            </Showcase>
          </Reveal>
          <Reveal delay="d1">
            <Showcase
              title="Hoca: kim teslim etti, kim bekliyor?"
              body="Her ödevin teslim tablosu öğrenci öğrenci durum gösterir; bakılması gerekenler en üstte."
            >
              <div className="lp-roster">
                <RosterRow name="Can Öztürk" chip="Benzerlik %100" kind="danger" />
                <RosterRow name="Elif Çelik" chip="Notlanmadı" kind="blue" />
                <RosterRow name="Mehmet Demir" chip="Notlandı · 95" kind="ok" />
                <RosterRow name="Burak Aydın" chip="Teslim yok" kind="muted" />
              </div>
            </Showcase>
          </Reveal>
          <Reveal>
            <Showcase
              title="Öğrenci: teslim etmeden önce kontrol et"
              body="Hoca izin verirse öğrenci kodunu kurallara göre ön kontrolden geçirir; eksiğini teslimden önce görür. Günlük hak sınırlıdır, teslim sayılmaz."
            >
              <div className="lp-precheck">
                <div className="row between">
                  <b style={{ fontSize: 14 }}>Ön kontrol sonucu</b>
                  <span className="chip">Kalan hak 2/3</span>
                </div>
                <div className="lp-req ok"><IconCheck size={14} /> Görev ekleme endpoint'i</div>
                <div className="lp-req ok"><IconCheck size={14} /> Görevleri listeleme</div>
                <div className="lp-req miss"><IconAlert size={14} /> En az 2 birim testi — test dosyası bulunamadı</div>
              </div>
            </Showcase>
          </Reveal>
          <Reveal delay="d1">
            <Showcase
              title="Sınıfın geneli: neyi tekrar anlatmalıyım?"
              body="AI sınıf özeti, kuralların sınıfta ne kadar karşılandığını ve tekrar eden eksikleri çıkarır. Eksikler tek tıkla öğrencilere bildirim olarak gönderilir."
            >
              <div className="lp-overview">
                <div className="lp-ov-row"><span>Girdi doğrulama</span><span className="lp-ov-bar"><i style={{ width: "38%" }} /></span><b>3/8</b></div>
                <div className="lp-ov-row"><span>Hata yönetimi (404)</span><span className="lp-ov-bar"><i style={{ width: "63%" }} /></span><b>5/8</b></div>
                <div className="lp-ov-row"><span>README</span><span className="lp-ov-bar"><i style={{ width: "88%" }} /></span><b>7/8</b></div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>Kuralı tam karşılayan öğrenci sayısı</div>
              </div>
            </Showcase>
          </Reveal>
        </div>
      </section>

      {/* ---------- KİMLER İÇİN ---------- */}
      <section className="lp-section">
        <Reveal>
          <div className="lp-kicker">Kimler için?</div>
          <h2 className="lp-h2">Hocaya zaman, öğrenciye yön</h2>
        </Reveal>
        <div className="lp-who">
          <Reveal>
            <div className="card lp-who-card">
              <span className="tag tag-gold">Akademisyen</span>
              <ul className="lp-check">
                <li>Ödev metnini yapıştır; AI kontrol edilebilir kurallara ayırsın.</li>
                <li>Teslimleri indirmeden, tarayıcıda sürüm sürüm ve satır satır incele.</li>
                <li>Kural kontrolü, Clean Code ve benzerlik analizini istediğin an çalıştır.</li>
                <li>AI'dan not önerisi al; notu sen ver, notlandıktan sonra gelen yeni sürümü gör.</li>
                <li>Sınıf özetiyle tekrar anlatılacak konuları bul, eksikleri öğrencilere gönder.</li>
                <li>Notları OBS'ye aktarmak için Excel'e indir.</li>
              </ul>
            </div>
          </Reveal>
          <Reveal delay="d1">
            <div className="card lp-who-card">
              <span className="tag tag-blue">Öğrenci</span>
              <ul className="lp-check">
                <li>Dosyalarını, proje klasörünü ya da ZIP'ini yükle; her yükleme yeni bir sürüm olur.</li>
                <li>Teslim etmeden önce ön kontrolle eksiklerini gör (hoca izin verirse).</li>
                <li>Hocanın satır yorumlarını, notunu ve AI geri bildirimini tek yerde oku.</li>
                <li>AI mentora kodunu sor; cevabı vermez, doğru yöne yönlendirir.</li>
                <li>Teslim süresini, uzatmaları ve notlarını bildirimlerle takip et.</li>
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- YAPAY ZEKA İLKELERİ ---------- */}
      <section className="lp-section">
        <Reveal>
          <div className="lp-kicker">Yapay zeka nasıl kullanılıyor?</div>
          <h2 className="lp-h2">Karar hocada, yapay zeka yardımcı</h2>
        </Reveal>
        <div className="lp-principles">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={(["", "d1", "d2", "d3"][i] as "" | "d1" | "d2" | "d3")}>
              <div className="lp-principle">
                <span className="lp-p-icon"><IconSparkle size={16} /></span>
                <h3>{p.title}</h3>
                <p className="muted">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- SSS ---------- */}
      <section className="lp-section" id="sss">
        <Reveal>
          <div className="lp-kicker">Sık sorulanlar</div>
          <h2 className="lp-h2">Aklına takılabilecekler</h2>
        </Reveal>
        <Reveal delay="d1">
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ---------- KAPANIŞ ---------- */}
      <Reveal>
        <div className="lp-cta">
          <h2 className="lp-h2" style={{ maxWidth: 640, margin: "0 auto 10px" }}>
            Hazır tanıtım sınıfıyla <span className="accent">hemen dene</span>.
          </h2>
          <p className="muted" style={{ maxWidth: 520, margin: "0 auto 22px" }}>
            8 öğrenci, 3 ödev ve gerçek yapay zeka analizleriyle dolu bir sınıf. Web'de ve telefonda aynı.
          </p>
          <div style={{ display: "flex", justifyContent: "center" }}>{primaryCta}</div>
        </div>
      </Reveal>
      <p className="faint" style={{ textAlign: "center", fontSize: 12.5, margin: "8px 0 28px" }}>
        <Link to="/aydinlatma">Kişisel verilerin korunması (KVKK aydınlatma metni)</Link>
      </p>
    </div>
  );
}

/* ---------- Görseller ---------- */
function RequirementMock() {
  return (
    <div className="lp-float">
      <div className="lp-review">
        <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="chip chip-blue">
            <IconSparkle size={12} /> Gereksinim kontrolü
          </span>
          <span className="muted" style={{ fontSize: 12 }}>Ödev 1 · Not Defteri API</span>
        </div>
        <div className="lp-cov">
          <b>%70</b>
          <span className="muted">kapsam · 3 tam · 1 kısmen · 1 eksik</span>
        </div>
        <div className="lp-req-list">
          <ReqLine st="ok" text="Not ekleme endpoint'i (POST)" ev="main.py · @app.post(&quot;/notes&quot;)" />
          <ReqLine st="ok" text="Notları listeleme (GET)" ev="main.py · list_notes()" />
          <ReqLine st="ok" text="README kurulumu anlatmalı" ev="README.md · Kurulum bölümü" />
          <ReqLine st="part" text="Olmayan not için 404" ev="Silmede 404 var, not getirmede yok" />
          <ReqLine st="miss" text="Boş başlık engellenmeli" ev="Girdi doğrulaması bulunamadı" />
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
          Her kural için kanıt gösterilir; not önerisi yalnızca referanstır.
        </div>
      </div>
    </div>
  );
}

function ReqLine({ st, text, ev }: { st: "ok" | "part" | "miss"; text: string; ev: string }) {
  const label = st === "ok" ? "Tam" : st === "part" ? "Kısmen" : "Eksik";
  return (
    <div className={`lp-rq lp-rq-${st}`}>
      <span className="lp-rq-st">{label}</span>
      <div style={{ minWidth: 0 }}>
        <div className="lp-rq-t">{text}</div>
        <div className="lp-rq-e" dangerouslySetInnerHTML={{ __html: ev }} />
      </div>
    </div>
  );
}

function Showcase({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="lp-show">
      <div className="lp-show-visual">{children}</div>
      <h3>{title}</h3>
      <p className="muted">{body}</p>
    </div>
  );
}

function MiniStat({ k, v, s, warn }: { k: string; v: string; s: string; warn?: boolean }) {
  return (
    <div className={"stat" + (warn ? " warn" : "")} style={{ padding: "10px 12px" }}>
      <div className="k" style={{ fontSize: 11.5 }}>{k}</div>
      <div className="v" style={{ fontSize: 24 }}>
        {v}
        <small>{s}</small>
      </div>
    </div>
  );
}

function RosterRow({ name, chip, kind }: { name: string; chip: string; kind: "danger" | "blue" | "ok" | "muted" }) {
  return (
    <div className="lp-roster-row">
      <span>{name}</span>
      <span className={kind === "muted" ? "chip" : `chip chip-${kind}`}>{chip}</span>
    </div>
  );
}

/* ---------- İçerik ---------- */
const PROBLEMS = [
  {
    before: "Onlarca projeyi tek tek indirip açmak, her kuralı kodun içinde aramak.",
    after: "Kod tarayıcıda açılır; AI her kuralı tam / kısmen / eksik olarak, kodda nerede olduğuyla işaretler.",
  },
  {
    before: "Birbirinden kopyalanmış teslimleri fark etmek şansa kalmış.",
    after: "Değişken adları değişse bile yapısal benzerlik ölçülür; yüksek benzerlik panoda uyarı olarak çıkar.",
  },
  {
    before: "Öğrenci geri bildirimi haftalar sonra, çoğu zaman sadece bir not olarak alır.",
    after: "Satır satır yorum, eksik kurallar ve kod kalitesi raporu aynı ekranda; yeni sürüm yükleyip gelişimini görür.",
  },
  {
    before: "Öğrenci teslim ettikten sonra bir kuralı atladığını fark eder.",
    after: "Hoca izin verirse teslimden önce ön kontrol yapar; eksiğini zamanında tamamlar.",
  },
];

const ROLE_LABEL = { hoca: "Hoca", ogr: "Öğrenci", ai: "Yapay zeka" } as const;

const JOURNEY: { who: keyof typeof ROLE_LABEL; title: string; body: string }[] = [
  {
    who: "hoca",
    title: "Ödevi ve kurallarını tanımlar",
    body: "Ödev metnini yapıştırır; AI metni kontrol edilebilir kurallara ayırır, hoca düzenler. Teslim tarihi ve ön kontrol izni belirlenir.",
  },
  {
    who: "ogr",
    title: "Teslim etmeden önce kontrol eder",
    body: "Hoca izin verdiyse kodunu kurallara göre ön kontrolden geçirir; eksik maddeleri görür. Bu bir teslim değildir, notlanmaz.",
  },
  {
    who: "ogr",
    title: "Projesini yükler",
    body: "Dosyalarını, klasörünü ya da ZIP'ini yükler; her yükleme yeni bir sürüm olur. Süre dolduysa yükleme kapanır, hoca uzatırsa yeniden açılır.",
  },
  {
    who: "ai",
    title: "Hoca isteyince analiz eder",
    body: "Kural kontrolü, Clean Code puanı ve intihal/benzerlik analizi yalnızca hoca başlattığında çalışır; sonuçlar kanıtlarıyla kaydedilir.",
  },
  {
    who: "hoca",
    title: "İnceler ve notlar",
    body: "Kodu satır satır okur, yorum bırakır. AI bir not önerisi sunar; notu hoca verir. Öğrenci bildirim alır.",
  },
  {
    who: "hoca",
    title: "Sınıfa bakar, dönemi kapatır",
    body: "Sınıf özetiyle ortak eksikleri görür, öğrencilere gönderir; dönem sonunda notları Excel'e aktarır.",
  },
];

const PRINCIPLES = [
  { title: "Yalnızca istendiğinde", body: "Analizleri hoca başlatır. Öğrencinin ön kontrolü de hocanın açtığı ödevde ve günlük hak sınırıyla çalışır." },
  { title: "Not hocanındır", body: "Yapay zeka not vermez; kapsam ve kod kalitesinden bir öneri hesaplar, hoca dilerse kullanır." },
  { title: "Kanıtla konuşur", body: "Her kural için kodun neresinde karşılandığı ya da neden eksik sayıldığı yazılır; hoca doğrulayabilir." },
  { title: "Emin değilse kaydetmez", body: "AI cevap veremezse sonuç uydurulmaz; kayıt yapılmaz ve tekrar denenmesi istenir." },
];

const FAQ = [
  { q: "Notu yapay zeka mı veriyor?", a: "Hayır. Yapay zeka yalnızca bir öneri hesaplar (kural kapsamı ve kod kalitesinden). Not alanını hoca doldurur." },
  {
    q: "Öğrenci ödevini yapay zekaya yaptırabilir mi?",
    a: "Uygulamadaki AI mentor çözüm yazmaz; soruya yönlendirici ipuçlarıyla cevap verir. Ön kontrol de yalnızca hangi kuralın eksik olduğunu söyler.",
  },
  {
    q: "Kopya tespiti kesin mi?",
    a: "Hayır, bir uyarıdır. Kodun yapısı karşılaştırılır (değişken adları değişse de yakalar). Yüksek benzerlik hocaya gösterilir; kararı hoca verir.",
  },
  {
    q: "Hangi dillerle çalışır?",
    a: "Python, JavaScript/TypeScript, Java, C/C++, C#, Go, PHP gibi yaygın dillerde yazılmış, dosya, klasör ya da ZIP olarak yüklenen projelerle. README gibi belgeler de kural kontrolünde okunur.",
  },
  {
    q: "OBS ile bağlantılı mı?",
    a: "Şu an değil. Notlar Excel dosyası olarak indirilip OBS'ye aktarılır. Doğrudan bağlantı okulun onayına ve verdiği erişime bağlıdır.",
  },
  {
    q: "Telefondan kullanılabilir mi?",
    a: "Evet. Telefon uygulamasında web'deki özelliklerin aynısı var: ödev verme, teslim inceleme, not, AI özeti, ön kontrol ve yükleme.",
  },
  {
    q: "Projelere kim erişebilir?",
    a: "Öğrenci yalnızca kendi teslimini, hoca yalnızca kendi sınıflarını görür. Proje indirme bağlantıları 5 dakika geçerlidir ve yalnızca o teslime aittir.",
  },
];
