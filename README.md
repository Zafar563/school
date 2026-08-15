# Maktab Qo'ng'irog'i Tizimi

Bu tizim ikki qismdan iborat:

1. **`server/`** — internetga joylashtiriladigan admin panel. Faqat login-parol bilan kirish mumkin. Tizim orqali Dushanba-Shanba kunlari uchun mustaqil jadvallarni belgilashingiz mumkin.
2. **`firmware/`** — ESP32 uchun dastur. Maktab WiFi-siga ulanadi, admin panelda saqlangan jadvalni davriy o'qib turadi va DS1302 soat moduli yordamida qo'ng'iroq relesini boshqaradi.

Internet uzilib qolsa ham qo'ng'iroq ishlayveradi, chunki ESP32 oxirgi olingan jadvalni o'z xotirasida (flash) saqlab qoladi va vaqtni DS1302 RTC moduldan (batareya bilan ishlaydi) internetdan mustaqil biladi.

> 💡 Bu tizim istalgan maktab uchun ishlatilishi mumkin — maktab nomi kodga yozib qo'yilmagan, balki admin panelning **Hisob** bo'limidan o'zgartiriladi (pastga qarang). Bitta kodni bir necha maktabga alohida-alohida joylashtirsangiz ham, har birida o'z nomini kiritishingiz kifoya.

---

## Kirish ma'lumotlarini yaratish

> ⚠️ Login-parolni faqat o'zingiz va mas'ul shaxs biladigan joyda saqlang — ochiq joyga (masalan umumiy chatga) yubormang.

Serverda quyidagi buyruq bilan o'zingizga kerakli login-parol yarating (`<login>` va `<parol>` o'rniga o'zingiz xohlagan qiymatlarni yozing):

```bash
node create-admin.js <login> <parol> admin
```

Agar hisob allaqachon mavjud bo'lsa va faqat parolni o'zgartirmoqchi bo'lsangiz:

```bash
node change-password.js <login> <yangi_parol>
```

Tizimga birinchi marta kirgach, **Hisob** bo'limidan maktabingiz nomini kiriting — u login sahifasi va boshqaruv panelida avtomatik ko'rinadi.

---

## 1-QISM: Serverni tayyorlash (kompyuteringizda, joylashtirishdan oldin)

```bash
cd server
npm install
cp .env.example .env
```

`.env` faylini oching va `SESSION_SECRET` qatoriga tasodifiy uzun matn qo'ying (masalan `openssl rand -hex 32` buyrug'i bilan yaratishingiz mumkin).

Admin hisobini yarating:

```bash
node create-admin.js <login> <parol> admin
```

Lokal test qilish:

```bash
npm start
```

Brauzerda `http://localhost:8080` oching.

---

## 2-QISM: Serverni internetga joylashtirish

### Variant A — Railway yoki Render (bepul/arzon, oson)
1. Loyihani GitHub'ga yuklang (`server/` papkasi ichidagi fayllar bilan).
2. [render.com](https://render.com) yoki [railway.app](https://railway.app) da yangi "Web Service" yarating, GitHub repo'ni bog'lang.
3. Build buyrug'i: `npm install`, Start buyrug'i: `npm start`.
4. Environment Variables bo'limiga `.env` dagi qiymatlarni kiriting, shu bilan birga `COOKIE_SECURE=true` qiling (chunki bu platformalar avtomatik HTTPS beradi).
5. Deploy bo'lgach, sizga masalan `https://maktab-qongirogi.onrender.com` kabi domen beriladi.
6. Terminal (Shell) orqali `node create-admin.js ...` buyrug'ini ishga tushiring.

### Variant B — o'z VPS serveringiz (masalan Ubuntu)
1. Node.js o'rnating, loyihani serverga ko'chiring.
2. `npm install --production`
3. Doimiy ishlashi uchun PM2 dan foydalaning.
4. Nginx orqali reverse proxy va Certbot bilan bepul HTTPS sertifikat sozlang, shunda domeningiz `https://` bilan ishlaydi.

**Muhim:** ESP32 HTTPS orqali ulanadi, shuning uchun serveringiz albatta `https://` (haqiqiy domen + SSL sertifikat) bilan ishlashi kerak.

---

## 3-QISM: Admin panelda jadvalni sozlash

1. Tizimga kiring.
2. **"Hisob"** bo'limida maktabingiz nomini kiritib saqlang (faqat bir marta kerak — login sahifasi va panelda shu nom ko'rinadi).
3. **"Jadval"** bo'limida har bir kun uchun alohida vaqtlarni kiriting. Har kunga xohlagancha qo'ng'iroq vaqti qo'shishingiz mumkin. "Kirish" va "Chiqish" turlarini tanlab, ohangni avtomatik sozlashingiz mumkin.
4. **"Qurilma"** bo'limiga o'ting — u yerda ESP32 uchun maxsus **API kalit** ko'rsatiladi. Uni nusxalab oling (bu kalitni hech kimga bermang).

---

## 4-QISM: ESP32 dasturini tayyorlash

1. `firmware/maktab_qongirogi_client.ino` faylini Arduino IDE'da oching.
2. Kutubxonalarni o'rnating: **Rtc by Makuna** (`ThreeWire.h` va `RtcDS1302.h` shu kutubxona ichida keladi), **ArduinoJson**.
3. Fayl boshidagi quyidagi qatorlarni to'ldiring:
   ```cpp
   const char* WIFI_SSID     = "MAKTAB_WIFI_NOMI";
   const char* WIFI_PASSWORD = "MAKTAB_WIFI_PAROLI";
   const char* SERVER_HOST   = "sizning-domeningiz.uz";
   const char* DEVICE_API_KEY = "admin paneldan olingan kalit";
   ```
4. Elektr sxemasi bo'yicha DS1302 va rele modulini pastdagi jadvalga qarab ulang.
5. Kodni ESP32'ga yuklang. Serial Monitor orqali WiFi ulanishi va "Jadval serverdan muvaffaqiyatli yangilandi" xabarini kuzatishingiz mumkin.

Shundan so'ng ESP32 har 2 daqiqada serverdan jadvalni tekshirib turadi — demak siz admin panelda jadvalni o'zgartirsangiz, o'zgarish 2 daqiqa ichida qurilmaga yetib boradi, ESP32'ni qayta dasturlash shart emas.

---

## ESP32 serverga qanday ulanadi (batafsil)

1. **WiFi'ga ulanish.** ESP32 yoqilganda maktab WiFi-siga ulanadi. Agar ulanolmasa, har 15 soniyada qayta urinib turadi.
2. **So'rov yuborish (HTTPS GET).** Ulangach, ESP32 `https://sizning-domeningiz/api/device/schedule` manziliga so'rov yuboradi va sarlavhaga (`X-API-KEY`) kalitni qo'shadi.
3. **Javobni saqlash.** Server joriy haftalik jadvalni JSON ko'rinishida qaytaradi. ESP32 buni **flash xotirasiga** yozib qo'yadi.
4. **Qayta so'rov — har 2 daqiqada.** Bu **doimiy ulanish emas**, balki "har 2 daqiqada bir marta so'rab turish" (polling) — bu WiFi uzilib-ulanib tursa ham eng barqaror ishlaydigan usul.
5. **Qo'ng'iroqni chalish — internetdan mustaqil.** Qo'ng'iroq vaqtini ESP32 internetdan emas, o'zidagi **DS1302 soat moduli**dan biladi. Internet birato'la uzilib qolsa ham, oxirgi olingan jadval bo'yicha qo'ng'iroq davom etaveradi.

Admin paneldagi **"Qurilma"** bo'limi shu jarayonni kuzatib boradi: ESP32 so'rov yuborgan sayin server "oxirgi ko'rilgan vaqt"ni yangilaydi, panel esa buni "onlayn / oflayn" ko'rinishida va jonli animatsiya bilan ko'rsatadi.

---

## ESP32 — Ulanish pinlari (DS1302 + Rele)

| Modul | Modul pini | ESP32 pini |
|---|---|---|
| DS1302 RTC | VCC | 3.3V yoki 5V |
| DS1302 RTC | GND | GND |
| DS1302 RTC | CLK | GPIO18 |
| DS1302 RTC | DAT (I/O) | GPIO19 |
| DS1302 RTC | RST (CE) | GPIO23 |
| Rele moduli | IN | GPIO26 |
| Rele moduli | VCC | 5V |
| Rele moduli | GND | GND |

> Pinlarni o'zgartirmoqchi bo'lsangiz, `.ino` faylining boshida `DS1302_CLK_PIN`, `DS1302_DAT_PIN`, `DS1302_RST_PIN` va `RELAY_PIN` qatorlarini tahrirlang.
# maktab
