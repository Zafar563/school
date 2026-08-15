/*
  MAKTAB QO'NG'IROG'I — ESP32 QURILMA DASTURI

  Bu versiya WiFi orqali serverga ulanadi va jadvalni oladi.
  - Har kun uchun alohida mustaqil jadval (Dushanba-Shanba).
  - Internet uzilsa ham oxirgi jadval bilan ishlashda davom etadi.
  - DS1302 RTC aniq vaqtni ta'minlaydi (3-simli interfeys: CLK/DAT/RST).

  KERAKLI KUTUBXONALAR (Arduino IDE -> Library Manager orqali o'rnating):
   - "Rtc by Makuna"   (ThreeWire.h va RtcDS1302.h shu kutubxona ichida keladi)
   - ArduinoJson

  ULASH:
   DS1302 CLK -> GPIO18, DAT(I/O) -> GPIO19, RST(CE) -> GPIO23, VCC -> 3.3V yoki 5V, GND -> GND
   RELE   IN  -> GPIO26, VCC -> 5V, GND -> GND

  DIQQAT: DS1302 moduli batareyani (CR2032) qayta zaryadlashga urinmasligi kerak —
  ko'pchilik "MH RTC" DS1302 modullarida zaryadlash rezistori/diodi olib
  tashlangan bo'ladi, lekin agar moduling'izda bu qism bo'lsa va batareya
  qayta zaryadlanmaydigan (oddiy CR2032) bo'lsa, ehtiyot bo'ling.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ThreeWire.h>
#include <RtcDS1302.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <vector>

// ==================== SIZ TO'LDIRISHINGIZ KERAK ====================
const char* WIFI_SSID     = "MAKTAB_WIFI_NOMI";
const char* WIFI_PASSWORD = "MAKTAB_WIFI_PAROLI";

// Serveringiz manzili
const char* SERVER_HOST   = "sizning-domeningiz.uz";   // https:// YOZMANG, faqat domen
const int   SERVER_PORT   = 443;                        // https uchun 443
const bool  USE_HTTPS     = true;

// Admin panelning "Qurilma" bo'limidan olingan API kalit
const char* DEVICE_API_KEY = "BU_YERGA_SERVERDAGI_APIKEYNI_QOYING";
// ======================================================================

// NTP Vaqt Sinxronizatsiyasi sozlamalari (Toshkent vaqti: UTC+5)
const char* NTP_SERVER_1     = "pool.ntp.org";
const char* NTP_SERVER_2     = "time.google.com";
const long  GMT_OFFSET_SEC   = 5 * 3600; // O'zbekiston / Toshkent (UTC+5)
const int   DAYLIGHT_OFFSET_SEC = 0;     // Yozgi vaqt yo'q
const unsigned long NTP_SYNC_INTERVAL_MS = 12UL * 60UL * 60UL * 1000UL; // Har 12 soatda bir marta DS1302 ni to'g'rilash

#define RELAY_PIN 26
#define RELAY_ACTIVE_HIGH true

// DS1302 pinlari (o'zgartirmoqchi bo'lsangiz, faqat shu 3 qatorni o'zgartiring)
#define DS1302_CLK_PIN 18   // DS1302 "CLK"
#define DS1302_DAT_PIN 19   // DS1302 "DAT" (I/O)
#define DS1302_RST_PIN 23   // DS1302 "RST" (CE)

const unsigned long SCHEDULE_FETCH_INTERVAL_MS = 2UL * 60UL * 1000UL; // har 2 daqiqada

ThreeWire myWire(DS1302_DAT_PIN, DS1302_CLK_PIN, DS1302_RST_PIN); // IO, SCLK, CE
RtcDS1302<ThreeWire> rtc(myWire);
Preferences prefs;

struct BellTime {
  uint8_t hour; uint8_t minute; uint16_t durationSec;
  bool pulsed;            // false = uzluksiz, true = uzib-uzib
  uint8_t pulseCount;
  uint16_t pulseGapSec;
};

std::vector<BellTime> daySchedule[7]; // 0-Yakshanba, 1-Dushanba ... 6-Shanba
std::vector<String> holidayDates;     // Bayram va ta'tillar sanalari (YYYY-MM-DD)

bool bellMuted = false;

int lastTriggeredMinute = -1;
unsigned long relayOffAt = 0;
bool relayIsOn = false;
unsigned long lastFetchAt = 0;

uint8_t pulsesLeft = 0;
uint16_t currentPulseOnSec = 0;
bool inGap = false;

// ---------------- XOTIRA ----------------

String scheduleToJson(std::vector<BellTime>& sch) {
  DynamicJsonDocument doc(3072);
  JsonArray arr = doc.to<JsonArray>();
  for (auto &t : sch) {
    JsonObject o = arr.createNestedObject();
    o["h"]=t.hour; o["m"]=t.minute; o["d"]=t.durationSec;
    o["rp"]=t.pulsed; o["pc"]=t.pulseCount; o["pg"]=t.pulseGapSec;
  }
  String out; serializeJson(doc, out); return out;
}

std::vector<BellTime> jsonToSchedule(String json) {
  std::vector<BellTime> sch;
  DynamicJsonDocument doc(3072);
  if (deserializeJson(doc, json)) return sch;
  for (JsonObject o : doc.as<JsonArray>()) {
    sch.push_back({
      (uint8_t)o["h"].as<int>(), (uint8_t)o["m"].as<int>(), (uint16_t)o["d"].as<int>(),
      o["rp"].as<bool>(),
      (uint8_t)(o["pc"].isNull() ? 3 : o["pc"].as<int>()),
      (uint16_t)(o["pg"].isNull() ? 1 : o["pg"].as<int>())
    });
  }
  return sch;
}

void saveToFlash() {
  prefs.begin("bell", false);
  for (int i=1;i<=6;i++) {
    prefs.putString(("day"+String(i)).c_str(), scheduleToJson(daySchedule[i]));
  }
  prefs.putBool("muted", bellMuted);

  // Bayramlar ro'yxatini saqlash
  DynamicJsonDocument hdoc(2048);
  JsonArray harr = hdoc.to<JsonArray>();
  for (const auto &h : holidayDates) harr.add(h);
  String hout; serializeJson(hdoc, hout);
  prefs.putString("holidays", hout);

  prefs.end();
}

void loadFromFlash() {
  prefs.begin("bell", true);
  for (int i=1;i<=6;i++) {
    daySchedule[i] = jsonToSchedule(prefs.getString(("day"+String(i)).c_str(), "[]"));
  }
  bellMuted = prefs.getBool("muted", false);

  // Bayramlar ro'yxatini yuklash
  holidayDates.clear();
  String hjson = prefs.getString("holidays", "[]");
  DynamicJsonDocument hdoc(2048);
  if (!deserializeJson(hdoc, hjson)) {
    for (JsonVariant v : hdoc.as<JsonArray>()) {
      holidayDates.push_back(v.as<String>());
    }
  }

  prefs.end();
}

BellTime parseBellTime(JsonObject o) {
  uint8_t pc = o["pulse_count"].isNull() ? 3 : (uint8_t)o["pulse_count"].as<int>();
  uint16_t pg = o["pulse_gap_sec"].isNull() ? 1 : (uint16_t)o["pulse_gap_sec"].as<int>();
  if (pc < 2) pc = 2;
  if (pg < 1) pg = 1;
  String pattern = o["ring_pattern"].as<String>();
  return {
    (uint8_t)o["hour"].as<int>(), (uint8_t)o["minute"].as<int>(), (uint16_t)o["duration_sec"].as<int>(),
    (pattern == "pulsed"), pc, pg
  };
}

// ---------------- SERVERDAN JADVAL OLISH ----------------

bool fetchScheduleFromServer() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;
  bool began;

  String url = String(USE_HTTPS ? "https://" : "http://") + SERVER_HOST + "/api/device/schedule";

  if (USE_HTTPS) {
    secureClient.setInsecure();
    began = http.begin(secureClient, url);
  } else {
    began = http.begin(plainClient, url);
  }
  if (!began) return false;

  http.addHeader("X-API-KEY", DEVICE_API_KEY);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("Jadval so'rovi muvaffaqiyatsiz, kod: %d\n", code);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, payload)) {
    Serial.println("JSON parse xatosi");
    return false;
  }

  JsonObject days = doc["days"].as<JsonObject>();
  for (int i=1;i<=6;i++) {
    JsonObject dayObj = days[String(i)];
    if (dayObj.isNull()) continue;
    std::vector<BellTime> items;
    for (JsonObject o : dayObj["items"].as<JsonArray>()) {
      items.push_back(parseBellTime(o));
    }
    daySchedule[i] = items;
  }

  // Bayramlar ro'yxatini qabul qilish
  if (!doc["holidays"].isNull()) {
    holidayDates.clear();
    for (JsonVariant v : doc["holidays"].as<JsonArray>()) {
      holidayDates.push_back(v.as<String>());
    }
  }

  if (!doc["muted"].isNull()) {
    bellMuted = doc["muted"].as<bool>();
  }

  saveToFlash();
  Serial.println("Jadval va bayramlar serverdan muvaffaqiyatli yangilandi.");
  return true;
}

// ---------------- RELE ----------------

void relayPinOn()  { digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? HIGH : LOW); }
void relayPinOff() { digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW  : HIGH); }

uint16_t currentPulseGapSec = 1;

void ringBell(const BellTime &t) {
  if (t.pulsed && t.pulseCount > 1) {
    pulsesLeft = t.pulseCount;
    currentPulseOnSec = t.durationSec;
    currentPulseGapSec = t.pulseGapSec;
    inGap = false;
    relayPinOn();
    relayIsOn = true;
    relayOffAt = millis() + (unsigned long)t.durationSec * 1000UL;
    Serial.printf("QO'NG'IROQ CHALINDI (uzib-uzib, %d marta)\n", t.pulseCount);
  } else {
    pulsesLeft = 0;
    relayPinOn();
    relayIsOn = true;
    relayOffAt = millis() + (unsigned long)t.durationSec * 1000UL;
    Serial.println("QO'NG'IROQ CHALINDI (uzluksiz)");
  }
}

void handleRelayTimer() {
  if (!relayIsOn || millis() < relayOffAt) return;

  if (pulsesLeft > 1 && !inGap) {
    relayPinOff();
    inGap = true;
    relayOffAt = millis() + (unsigned long)currentPulseGapSec * 1000UL;
    return;
  }
  if (pulsesLeft > 1 && inGap) {
    pulsesLeft--;
    inGap = false;
    relayPinOn();
    relayOffAt = millis() + (unsigned long)currentPulseOnSec * 1000UL;
    return;
  }
  relayPinOff();
  relayIsOn = false;
  pulsesLeft = 0;
}

bool isTodayHoliday(const RtcDateTime &now) {
  char todayBuf[16];
  snprintf(todayBuf, sizeof(todayBuf), "%04d-%02d-%02d", now.Year(), now.Month(), now.Day());
  String todayStr = String(todayBuf);
  for (const auto &h : holidayDates) {
    if (h == todayStr) return true;
  }
  return false;
}

void checkSchedule() {
  RtcDateTime now = rtc.GetDateTime();
  if (now.Minute() == lastTriggeredMinute) return;

  // Bugun bayram yoki ta'til ekanligini tekshirish
  if (isTodayHoliday(now)) {
    if (lastTriggeredMinute == -1) {
      Serial.println("Bugun bayram/ta'til kuni deb belgilangan — qo'ng'iroq chalinmaydi.");
    }
    lastTriggeredMinute = now.Minute();
    return;
  }

  int dow = now.DayOfWeek(); // 0=Yakshanba, 1=Dushanba ... 6=Shanba
  std::vector<BellTime>& active = daySchedule[dow];

  for (auto &t : active) {
    if (t.hour == now.Hour() && t.minute == now.Minute()) {
      if (!bellMuted) {
        ringBell(t);
      } else {
        Serial.println("Qo'ng'iroq vaqti keldi, lekin tizim o'chirilgan — chalinmadi.");
      }
      break;
    }
  }
  lastTriggeredMinute = now.Minute();
}

unsigned long lastNtpSyncAt = 0;

// ---------------- NTP VAQT SINXRONIZATSIYASI ----------------
bool syncTimeWithNTP() {
  if (WiFi.status() != WL_CONNECTED) return false;

  Serial.println("NTP serverdan Toshkent aniq vaqti so'ralmoqda...");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);

  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 10) {
    delay(400);
    attempts++;
  }

  if (attempts >= 10) {
    Serial.println("⚠️ NTP serverdan vaqtni olib bo'lmadi.");
    return false;
  }

  RtcDateTime ntpTime(
    timeinfo.tm_year + 1900,
    timeinfo.tm_mon + 1,
    timeinfo.tm_mday,
    timeinfo.tm_hour,
    timeinfo.tm_min,
    timeinfo.tm_sec
  );

  rtc.SetDateTime(ntpTime);
  lastNtpSyncAt = millis();
  Serial.printf("✅ DS1302 soati NTP orqali to'g'rilandi: %04d-%02d-%02d %02d:%02d:%02d (UTC+5)\n",
    ntpTime.Year(), ntpTime.Month(), ntpTime.Day(),
    ntpTime.Hour(), ntpTime.Minute(), ntpTime.Second());
  return true;
}

// ---------------- WIFI ----------------

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi-ga ulanmoqda");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Ulandi. IP: ");
    Serial.println(WiFi.localIP());
    syncTimeWithNTP();
  } else {
    Serial.println("WiFi-ga ulanib bo'lmadi, keyinroq qayta urinib ko'riladi.");
  }
}

// ---------------- SETUP / LOOP ----------------

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW : HIGH);

  rtc.Begin();
  RtcDateTime compiled = RtcDateTime(__DATE__, __TIME__);
  if (!rtc.IsDateTimeValid()) {
    // Batareya birinchi marta ulanganda yoki tamom bo'lib qolganda vaqt yo'qoladi —
    // shunday holatda kompyuter/kompilyatsiya vaqtiga qayta o'rnatiladi.
    Serial.println("DS1302 vaqti noto'g'ri/yo'qolgan, dastlabki vaqtga o'rnatilmoqda...");
    rtc.SetDateTime(compiled);
  }
  if (rtc.GetIsWriteProtected()) {
    rtc.SetIsWriteProtected(false);
  }
  if (!rtc.GetIsRunning()) {
    rtc.SetIsRunning(true);
  }

  loadFromFlash();

  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) {
    fetchScheduleFromServer();
  }
  lastFetchAt = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastRetry = 0;
    if (millis() - lastRetry > 15000) {
      lastRetry = millis();
      connectWiFi();
    }
  }

  // Har 2 daqiqada serverdan jadvalni tekshirish
  if (millis() - lastFetchAt > SCHEDULE_FETCH_INTERVAL_MS) {
    lastFetchAt = millis();
    fetchScheduleFromServer();
  }

  // Har 12 soatda bir marta DS1302 vaqtini NTP orqali to'g'rilab turish
  if (WiFi.status() == WL_CONNECTED && (millis() - lastNtpSyncAt > NTP_SYNC_INTERVAL_MS)) {
    syncTimeWithNTP();
  }

  if (bellMuted && relayIsOn) {
    relayPinOff();
    relayIsOn = false;
    pulsesLeft = 0;
    Serial.println("Tizim o'chirilgani sababli qo'ng'iroq to'xtatildi.");
  }

  checkSchedule();
  handleRelayTimer();
}
