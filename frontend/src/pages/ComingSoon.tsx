export function ComingSoon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="h-page" style={{ marginBottom: 10 }}>{title}</h1>
      <div className="card">
        <span className="tag tag-blue">Yakında</span>
        <p className="muted" style={{ marginTop: 12 }}>
          Bu bölüm yakında açılacak. Sınıf ve bölüm bazlı soru-cevap alanı üzerinde
          çalışıyoruz.
        </p>
      </div>
    </div>
  );
}
