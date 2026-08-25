/*
  Maktab Qo'ng'irog'i — ESP32 Mijoz Dasturi (Real-Time WebSocket + Offline RTC Resilient)
  =====================================================================================
  Imkoniyatlari:
    1. WebSocket orqali Real-Time 0-kechikish (0-delay Instant Trevoga & Sinov)
    2. DS1302 RTC va Flash orqali internet uzilsa ham 100% mustaqil ishlash
    3. NTP orqali DS1302 vaqtini har 12 soatda avtomatik to'g'rilash (UTC+5)
    4. HTTP orqali zaxira jadval yangilanishi

  Pinlar ulanishi:
    DS1302 CLK -> GPIO18, DAT (I/O) -> GPIO19, RST (CE) -> GPIO23, VCC -> 3.3V/5V, GND -> GND
    RELE   IN  -> GPIO26, VCC -> 5V, GND -> GND
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ThreeWire.h>
#include <RtcDS1302.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <vector>

// ==================== SIZ TO'LDIRISHINGIZ KERAK ====================
const char* WIFI_SSID     = "MAKTAB_WIFI_NOMI";
const char* WIFI_PASSWORD = "MAKTAB_WIFI_PAROLI";

// Serveringiz manzili (IP yoki Domen)
const char* SERVER_HOST   = "157.230.53.183";   // http:// yoki https:// YOZMANG!
const int   SERVER_PORT   = 3000;               // Port (masalan 3000 yoki HTTPS uchun 443)
const bool  USE_HTTPS     = false;              // Agar VPS da HTTPS bo'lsa true qiling

// Admin panelning "Qurilma" bo'limidan olingan o'zingizning API kalitingiz
const char* DEVICE_API_KEY = "admin_key_xxxxxxxx";
// ======================================================================

// NTP Vaqt Sinxronizatsiyasi sozlamalari (Toshkent vaqti: UTC+5)
const char* NTP_SERVER_1     = "pool.ntp.org";
const char* NTP_SERVER_2     = "time.google.com";
const long  GMT_OFFSET_SEC   = 5 * 3600; // O'zbekiston / Toshkent (UTC+5)
const int   DAYLIGHT_OFFSET_SEC = 0;     // Yozgi vaqt yo'q
const unsigned long NTP_SYNC_INTERVAL_MS = 12UL * 60UL * 60UL * 1000UL; // Har 12 soatda

#define RELAY_PIN 26
#define RELAY_ACTIVE_HIGH true

// DS1302 pinlari
#define DS1302_CLK_PIN 18   // DS1302 "CLK"
#define DS1302_DAT_PIN 19   // DS1302 "DAT" (I/O)
#define DS1302_RST_PIN 23   // DS1302 "RST" (CE)

const unsigned long SCHEDULE_FETCH_INTERVAL_MS = 2UL * 60UL * 1000UL; // HTTP zaxira: har 2 daqiqa

ThreeWire myWire(DS1302_DAT_PIN, DS1302_CLK_PIN, DS1302_RST_PIN);
RtcDS1302<ThreeWire> rtc(myWire);
Preferences prefs;
WebSocketsClient webSocket;

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
unsigned long lastNtpSyncAt = 0;

uint8_t pulsesLeft = 0;
uint16_t currentPulseOnSec = 0;
uint16_t currentPulseGapSec = 1;
bool inGap = false;

// ---------------- RELE FUNKSIYALARI ----------------
void relayPinOn()  { digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? HIGH : LOW); }
void relayPinOff() { digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW  : HIGH); }

void ringBellDirect(uint16_t durationSec, const char* pattern, uint8_t pulseCount, uint16_t pulseGapSec) {
  if (strcmp(pattern, "pulsed") == 0 && pulseCount > 1) {
    pulsesLeft = pulseCount;
    currentPulseOnSec = durationSec;
    currentPulseGapSec = pulseGapSec;
    inGap = false;
    relayPinOn();
    relayIsOn = true;
    relayOffAt = millis() + (unsigned long)durationSec * 1000UL;
    Serial.printf("🔔 QO'NG'IROQ CHALINDI (uzib-uzib, %d marta, %d soniya)\n", pulseCount, durationSec);
  } else {
    pulsesLeft = 0;
    relayPinOn();
    relayIsOn = true;
    relayOffAt = millis() + (unsigned long)durationSec * 1000UL;
    Serial.printf("🔔 QO'NG'IROQ CHALINDI (uzluksiz, %d soniya)\n", durationSec);
  }
}

void ringBell(const BellTime &t) {
  ringBellDirect(t.durationSec, t.pulsed ? "pulsed" : "continuous", t.pulseCount, t.pulseGapSec);
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

// ---------------- XOTIRA (FLASH) ----------------
String scheduleToJson(std::vector<BellTime>& sch) {
  DynamicJsonDocument doc(2048);
  JsonArray arr = doc.to<JsonArray>();
  for (auto &t : sch) {
    JsonObject obj = arr.createNestedObject();
    obj["h"] = t.hour;
    obj["m"] = t.minute;
    obj["d"] = t.durationSec;
    obj["p"] = t.pulsed ? 1 : 0;
    obj["pc"] = t.pulseCount;
    obj["pg"] = t.pulseGapSec;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

void jsonToSchedule(const String &jsonStr, std::vector<BellTime>& sch) {
  sch.clear();
  if (jsonStr.length() == 0) return;
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, jsonStr)) return;
  JsonArray arr = doc.as<JsonArray>();
  for (JsonObject obj : arr) {
    BellTime t;
    t.hour = obj["h"] | 8;
    t.minute = obj["m"] | 0;
    t.durationSec = obj["d"] | 5;
    t.pulsed = (obj["p"] | 0) == 1;
    t.pulseCount = obj["pc"] | 3;
    t.pulseGapSec = obj["pg"] | 1;
    sch.push_back(t);
  }
}

String holidaysToJson() {
  DynamicJsonDocument doc(2048);
  JsonArray arr = doc.to<JsonArray>();
  for (const auto &h : holidayDates) arr.add(h);
  String out;
  serializeJson(doc, out);
  return out;
}

void jsonToHolidays(const String &jsonStr) {
  holidayDates.clear();
  if (jsonStr.length() == 0) return;
  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, jsonStr)) return;
  JsonArray arr = doc.as<JsonArray>();
  for (const char* h : arr) {
    if (h) holidayDates.push_back(String(h));
  }
}

void saveToFlash() {
  prefs.begin("bellsched", false);
  for (int d = 0; d <= 6; d++) {
    String key = "d" + String(d);
    prefs.putString(key.c_str(), scheduleToJson(daySchedule[d]));
  }
  prefs.putString("holidays", holidaysToJson());
  prefs.putBool("muted", bellMuted);
  prefs.end();
  Serial.println("💾 Jadval ESP32 Flash xotirasiga saqlandi.");
}

void loadFromFlash() {
  prefs.begin("bellsched", true);
  for (int d = 0; d <= 6; d++) {
    String key = "d" + String(d);
    String val = prefs.getString(key.c_str(), "");
    jsonToSchedule(val, daySchedule[d]);
  }
  String holVal = prefs.getString("holidays", "");
  jsonToHolidays(holVal);
  bellMuted = prefs.getBool("muted", false);
  prefs.end();
  Serial.println("📂 Flash xotiradan saqlangan jadval yuklandi.");
}

// ---------------- JADVAL PARSER ----------------
void parseAndSaveSchedule(JsonObject root) {
  for (int d = 0; d <= 6; d++) daySchedule[d].clear();

  if (root.containsKey("days")) {
    JsonObject days = root["days"];
    for (JsonPair p : days) {
      int d = atoi(p.key().c_str());
      if (d < 0 || d > 6) continue;
      JsonObject dInfo = p.value().as<JsonObject>();
      if (dInfo.containsKey("items")) {
        JsonArray items = dInfo["items"];
        for (JsonObject it : items) {
          BellTime t;
          t.hour = it["hour"] | 8;
          t.minute = it["minute"] | 0;
          t.durationSec = it["duration_sec"] | 5;
          const char* pat = it["ring_pattern"] | "continuous";
          t.pulsed = (strcmp(pat, "pulsed") == 0);
          t.pulseCount = it["pulse_count"] | 3;
          t.pulseGapSec = it["pulse_gap_sec"] | 1;
          daySchedule[d].push_back(t);
        }
      }
    }
  }

  holidayDates.clear();
  if (root.containsKey("holidays")) {
    JsonArray holArr = root["holidays"];
    for (const char* h : holArr) {
      if (h) holidayDates.push_back(String(h));
    }
  }

  if (root.containsKey("muted")) {
    bellMuted = root["muted"].as<bool>();
  }

  saveToFlash();
}

// ---------------- WEBSOCKET REAL-TIME HODISALAR ----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("⚠️ [WebSocket] Aloqa uzildi. Qayta ulanmoqda...");
      break;

    case WStype_CONNECTED:
      Serial.println("🟢 [WebSocket] SERVER BILAN REAL-TIME ALOQA O'RNATILDI! (0-delay)");
      break;

    case WStype_TEXT: {
      DynamicJsonDocument doc(8192);
      DeserializationError error = deserializeJson(doc, payload);
      if (error) return;

      const char* msgType = doc["type"] | "";

      // 1. ZUDLIK BILAN REAL-TIME BUYRUQ (0 SONIYA KECHIKISH!)
      if (strcmp(msgType, "command") == 0) {
        const char* action = doc["action"] | "";
        if (strcmp(action, "stop") == 0) {
          relayPinOff();
          relayIsOn = false;
          pulsesLeft = 0;
          Serial.println("🛑 [WebSocket] DARHOL TO'XTATISH BUYRUG'I IJRO ETILDI!");
        } else if (strcmp(action, "ring") == 0) {
          uint16_t dur = doc["duration_sec"] | 5;
          const char* pat = doc["ring_pattern"] | "continuous";
          uint8_t pc = doc["pulse_count"] | 3;
          uint16_t pg = doc["pulse_gap_sec"] | 1;
          Serial.printf("🚨 [WebSocket] REAL-TIME BUYRUQ KELDI: %s (%d soniya)!\n", pat, dur);
          ringBellDirect(dur, pat, pc, pg);
        }
      }
      // 2. JADVAL YOKI MUTE O'ZGARISHI (REAL-TIME PUSH)
      else if (strcmp(msgType, "schedule_updated") == 0 || strcmp(msgType, "init") == 0) {
        Serial.println("⚡ [WebSocket] Yangi jadval keldi, Flash-ga yozilmoqda...");
        if (doc.containsKey("schedule")) {
          JsonObject schObj = doc["schedule"];
          parseAndSaveSchedule(schObj);
        }
      }
      break;
    }

    case WStype_PONG:
      break;

    default:
      break;
  }
}

void setupWebSocket() {
  String path = "/ws/device?key=" + String(DEVICE_API_KEY);
  if (USE_HTTPS) {
    webSocket.beginSSL(SERVER_HOST, SERVER_PORT, path.c_str());
  } else {
    webSocket.begin(SERVER_HOST, SERVER_PORT, path.c_str());
  }
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

// ---------------- HTTP ZAXIRA SO'ROVI ----------------
void fetchScheduleFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient client;
  WiFiClientSecure secureClient;
  if (USE_HTTPS) secureClient.setInsecure();

  HTTPClient http;
  String url = String(USE_HTTPS ? "https://" : "http://") + SERVER_HOST + ":" + String(SERVER_PORT) + "/api/device/schedule";

  bool ok = USE_HTTPS ? http.begin(secureClient, url) : http.begin(client, url);
  if (!ok) return;

  http.addHeader("X-API-KEY", DEVICE_API_KEY);
  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(8192);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      JsonObject root = doc.as<JsonObject>();
      parseAndSaveSchedule(root);

      if (root.containsKey("command")) {
        JsonObject cmd = root["command"];
        const char* action = cmd["action"] | "";
        if (strcmp(action, "stop") == 0) {
          relayPinOff();
          relayIsOn = false;
          pulsesLeft = 0;
        } else if (strcmp(action, "ring") == 0) {
          uint16_t dur = cmd["duration_sec"] | 5;
          const char* pat = cmd["ring_pattern"] | "continuous";
          uint8_t pc = cmd["pulse_count"] | 3;
          uint16_t pg = cmd["pulse_gap_sec"] | 1;
          ringBellDirect(dur, pat, pc, pg);
        }
      }
    }
  }
  http.end();
}

// ---------------- SOAT VA JADVALNI TEKSHIRISH ----------------
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

  if (isTodayHoliday(now)) {
    if (lastTriggeredMinute == -1) {
      Serial.println("Bugun bayram/ta'til — qo'ng'iroq chalinmaydi.");
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
        Serial.println("Qo'ng'iroq vaqti keldi, lekin tizim o'chirilgan (Muted).");
      }
      break;
    }
  }
  lastTriggeredMinute = now.Minute();
}

bool syncTimeWithNTP() {
  if (WiFi.status() != WL_CONNECTED) return false;
  Serial.println("NTP serverdan Toshkent aniq vaqti so'ralmoqda...");
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);

  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 10) {
    delay(300);
    attempts++;
  }

  if (attempts >= 10) {
    Serial.println("⚠️ NTP serverdan vaqtni olib bo'lmadi.");
    return false;
  }

  RtcDateTime ntpTime(
    timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec
  );

  rtc.SetDateTime(ntpTime);
  lastNtpSyncAt = millis();
  Serial.printf("✅ DS1302 soati NTP orqali to'g'rilandi: %04d-%02d-%02d %02d:%02d:%02d (UTC+5)\n",
    ntpTime.Year(), ntpTime.Month(), ntpTime.Day(),
    ntpTime.Hour(), ntpTime.Minute(), ntpTime.Second());
  return true;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi-ga ulanmoqda");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    checkSchedule();
    handleRelayTimer();
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Ulandi. IP: ");
    Serial.println(WiFi.localIP());
    syncTimeWithNTP();
    setupWebSocket();
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
    Serial.println("DS1302 vaqti noto'g'ri, dastlabki vaqtga o'rnatilmoqda...");
    rtc.SetDateTime(compiled);
  }
  if (rtc.GetIsWriteProtected()) rtc.SetIsWriteProtected(false);
  if (!rtc.GetIsRunning()) rtc.SetIsRunning(true);

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
  } else {
    webSocket.loop(); // Real-Time WebSocket tinglash (0-kechikish)
  }

  // Zaxira HTTP yangilanishi (har 2 daqiqa)
  if (millis() - lastFetchAt > SCHEDULE_FETCH_INTERVAL_MS) {
    lastFetchAt = millis();
    fetchScheduleFromServer();
  }

  // DS1302 vaqtini NTP orqali to'g'rilab turish (har 12 soatda)
  if (WiFi.status() == WL_CONNECTED && (millis() - lastNtpSyncAt > NTP_SYNC_INTERVAL_MS)) {
    syncTimeWithNTP();
  }

  if (bellMuted && relayIsOn) {
    relayPinOff();
    relayIsOn = false;
    pulsesLeft = 0;
  }

  checkSchedule();
  handleRelayTimer();
}
