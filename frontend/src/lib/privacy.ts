/** KVKK aydınlatma metni — web ve mobil aynı içeriği gösterir (mobile/src/privacy.ts birebir kopyası).
 *  Veri sorumlusu ve iletişim bilgisi sunucudan gelir (GET /meta/privacy).
 *  Not: Bu metin bir taslaktır; okulun hukuk birimi / KVKK sorumlusu tarafından gözden geçirilmelidir. */

export const PRIVACY_UPDATED = "25 Eylül 2026";

export type PrivacySection = { title: string; paragraphs?: string[]; bullets?: string[] };

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    title: "Bu metin ne anlatıyor?",
    paragraphs: [
      "Kernel; ödev teslimi, hoca değerlendirmesi, yapay zekâ destekli kod analizi ve topluluk özelliklerini sunan bir eğitim platformudur. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) 10. madde kapsamında, hangi kişisel verilerini neden ve nasıl işlediğimizi burada açıklıyoruz.",
    ],
  },
  {
    title: "Hangi verileri işliyoruz?",
    bullets: [
      "Kimlik ve hesap: ad soyad, okul/personel numarası, üniversite, rol (öğrenci/akademisyen).",
      "Eğitim verileri: kayıtlı olduğun sınıflar, ödev teslimlerin (yüklediğin kod dosyaları ve içerikleri), sürümler, notlar, hoca yorumları.",
      "Yapay zekâ sonuçları: gereksinim kontrolü, kod kalitesi analizi, ön kontrol ve AI mentor sohbetlerin.",
      "Topluluk: gönderilerin, yanıtların ve oyların.",
      "Güvenlik kayıtları: giriş zamanları, IP adresi, cihaz/tarayıcı türü, hatalı giriş denemeleri, açık oturumların.",
    ],
  },
  {
    title: "Neden işliyoruz?",
    bullets: [
      "Ödev teslimi, değerlendirme ve notlandırma sürecini yürütmek.",
      "Hocanın istediği yapay zekâ analizleriyle geri bildirim üretmek ve gelişimini göstermek.",
      "Hesabını korumak: yetkisiz girişleri tespit etmek, yeni cihaz bildirimi göndermek, kötüye kullanımı önlemek.",
      "Hizmetin çalışmasını, yedeklenmesini ve hataların giderilmesini sağlamak.",
    ],
  },
  {
    title: "Yapay zekâ analizi nasıl çalışır?",
    paragraphs: [
      "Yapay zekâ yalnızca bir akademisyen istediğinde (ya da hocanın açtığı ön kontrolde sen istediğinde) çalışır; kendiliğinden çalışmaz.",
      "Analiz için yapay zekâ sağlayıcısına yalnızca teslim ettiğin kod dosyaları, ödevin gereksinimleri ve (mentorda) yazdığın soru gönderilir. Adın, okul numaran ve e-postan gönderilmez. Kodunun içine (yorum satırı, README) kişisel bilgi yazarsan o da gönderilmiş olur; bu yüzden koduna kişisel bilgi yazmamanı öneririz.",
      "Benzerlik (intihal) karşılaştırması sağlayıcıya gönderilmeden, tamamen kendi sunucumuzda yapılır.",
      "Hoca, yapay zekâ sonuçlarının bir kısmını senden gizleyebilir; notunu her zaman hoca verir, yapay zekâ yalnızca yardımcıdır.",
    ],
  },
  {
    title: "Veriler kimlere ve nereye aktarılıyor?",
    bullets: [
      "Hocan: yalnızca kendi sınıflarındaki öğrencilerin teslim ve sonuçlarını görür.",
      "Sistem yöneticisi: hesap ve güvenlik yönetimi için.",
      "Altyapı hizmet sağlayıcıları (barındırma, veritabanı, dosya deposu) ve yapay zekâ sağlayıcısı (Anthropic). Bu sağlayıcıların sunucuları yurt dışında bulunabilir; bu nedenle verilerin KVKK 9. madde kapsamında yurt dışına aktarılmış olur.",
      "Verilerin reklam veya pazarlama amacıyla kimseyle paylaşılmaz ve satılmaz.",
    ],
  },
  {
    title: "Ne kadar süre saklıyoruz?",
    bullets: [
      "Eğitim verileri: dersin/dönemin değerlendirme ve itiraz süreci boyunca; sonrasında kurumun belirlediği süre dolunca silinir veya anonimleştirilir.",
      "Güvenlik kayıtları: 1 yıl.",
      "Oturum kayıtları: oturum sona erdikten sonra en fazla 60 gün.",
      "Şifreli yedekler: 90 gün.",
    ],
  },
  {
    title: "Nasıl koruyoruz?",
    bullets: [
      "Tüm bağlantılar şifrelidir (HTTPS). Şifreler geri çevrilemez biçimde (bcrypt) saklanır; kimse, yöneticiler dahil, şifreni göremez.",
      "İki adımlı doğrulama, hatalı girişte hesap kilidi, yeni cihaz bildirimi ve oturumları uzaktan kapatma.",
      "Rol bazlı erişim: herkes yalnızca yetkili olduğu veriyi görür.",
      "Yedekler şifrelenerek saklanır; yönetici işlemleri kayıt altındadır.",
    ],
  },
  {
    title: "Hakların (KVKK 11. madde)",
    bullets: [
      "Kişisel verilerinin işlenip işlenmediğini öğrenme ve işlenmişse bilgi isteme.",
      "İşlenme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme.",
      "Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme.",
      "Eksik veya yanlış işlenmişse düzeltilmesini, şartları oluşmuşsa silinmesini veya yok edilmesini isteme.",
      "Otomatik sistemlerle analiz edilmesi sonucu aleyhine bir sonuç çıkmasına itiraz etme.",
      "Kanuna aykırı işleme nedeniyle zarara uğrarsan zararın giderilmesini talep etme.",
    ],
  },
];
