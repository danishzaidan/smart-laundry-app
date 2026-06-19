#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>

#define SS_PIN  5
#define RST_PIN 22
MFRC522 mfrc522(SS_PIN, RST_PIN);

// 🌐 LINK SUDAH DI-UPDATE KE VERCEL KAMU
const char* serverURL = "https://smart-laundry-project.vercel.app/api/iot/rfid_scan";

void setup() {
  Serial.begin(115200);
  SPI.begin();
  mfrc522.PCD_Init();

  Serial.println("\nMenghubungkan ke WiFi Wokwi-GUEST...");
  WiFi.begin("Wokwi-GUEST", "", 6);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\n✅ WiFi Terhubung!");
  Serial.println("Silakan tap kartu RFID Anda di Wokwi...");
}

void loop() {
  // Tunggu sampai ada kartu yang ditempel
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return; 
  }

  // Baca UID
  String uidString = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uidString += "0";
    uidString += String(mfrc522.uid.uidByte[i], HEX);
  }
  uidString.toUpperCase();

  Serial.println("\n💳 Kartu Terbaca: " + uidString);
  Serial.println("Mengirim data ke Server Vercel...");

  // Kirim HTTP POST ke Server via WiFi
  if(WiFi.status() == WL_CONNECTED){
    HTTPClient http;
    http.begin(serverURL);
    
    // Beri tahu server bahwa kita ngirim format JSON
    http.addHeader("Content-Type", "application/json");
    http.addHeader("User-Agent", "ESP32-Wokwi");

    // Bungkus UID menjadi format JSON
    String payload = "{\"rfid_uid\":\"" + uidString + "\"}";
    
    // Tembak!
    int httpResponseCode = http.POST(payload);

    if(httpResponseCode == 200) {
      Serial.println("✅ Berhasil kirim! Cek layar Web Simulate kamu.");
    } else {
      Serial.print("❌ Error ngirim data! Kode HTTP: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  } else {
    Serial.println("❌ WiFi Terputus!");
  }

  // Jeda agar tidak ngirim dobel saat kartu ditahan
  mfrc522.PICC_HaltA();
  delay(3000); 
}
