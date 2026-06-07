#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "SINGTEL-WNP6";
const char* password = "thanhxuan";

WiFiServer server(12345);
String firebaseURL = "https://smarthomeapp-982da-default-rtdb.asia-southeast1.firebasedatabase.app/test/data.json"; // your Firebase URL with write permission

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nConnected WiFi. IP: " + WiFi.localIP().toString());

  server.begin();
}

void loop() {
  WiFiClient client = server.available();
  if (client) {
    String receivedData = "";
    while (client.connected()) {
      if (client.available()) {
        receivedData += client.readStringUntil('\n');
        if (receivedData.endsWith("\n")) break;
      }
    }
    Serial.println("Received data: " + receivedData);

    // Parse account info from receivedData (assuming JSON format)
    StaticJsonDocument<200> doc;
    DeserializationError error = deserializeJson(doc, receivedData);
    if (!error) {
      String username = doc["username"];
      String email = doc["email"];

      // Send data to Firebase
      sendToFirebase(username, email);
    } else {
      Serial.println("Failed to parse JSON");
    }

    client.stop();
  }
}

void sendToFirebase(const String& username, const String& email) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(firebaseURL);
    http.addHeader("Content-Type", "application/json");

    // Prepare JSON payload
    StaticJsonDocument<200> jsonDoc;
    jsonDoc["username"] = username;
    jsonDoc["email"] = email;
    String jsonData;
    serializeJson(jsonDoc, jsonData);

    int httpResponseCode = http.POST(jsonData);
    if (httpResponseCode > 0) {
      Serial.println("Data sent: " + String(httpResponseCode));
    } else {
      Serial.println("Failed to send data");
    }
    http.end();
  }
}