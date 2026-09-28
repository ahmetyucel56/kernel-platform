# Kernel — Mobil (Expo / React Native)

Öğrenci deneyimine odaklı ilk mobil sürüm. **Varsayılan olarak canlı backend'e**
(`https://kernel-backend-40le.onrender.com`) bağlanır — telefonda hemen çalışır.

## Bu sürümde var
- Proliz tarzı giriş (üniversite + okul no + şifre)
- **Panom**: hoş geldin, aktif ödevler, Clean Code gelişim grafiği, rozetler
- **Ödevlerim**: ödev listesi (deadline, gereksinimler, sürüm sayısı) — salt-okunur
- **Profil** + çıkış

## Çalıştırma
```bash
cd mobile
npm install
# (versiyon uyumu icin onerilir:)
npx expo install
npx expo start
```
Sonra telefonuna **Expo Go** uygulamasını kurup terminaldeki **QR kodu** okut.

Demo giriş: Üniversite `Demo Üniversitesi`, şifre `parola123`
Öğrenci No `2025001` / `2025002` · Personel No `9001`

## Başka bir backend'e bağlamak
```bash
EXPO_PUBLIC_API_URL=http://<bilgisayar-ip>:8000 npx expo start
```
(Yerel backend için telefon ile aynı Wi-Fi'da olmalısın ve backend'i `--host 0.0.0.0` ile çalıştırmalısın.)

## Sonraki adımlar (yapılacak)
- ZIP yükleme (expo-document-picker)
- Gönderim görüntüleyici (dosya ağacı + kod)
- Akademisyen ekranları
- Push bildirim

> Not: Bu iskelet henüz cihazda test edilmedi; çalıştırıp hata alırsan logu paylaş,
> hızlıca düzeltelim.
