#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_VL53L0X.h>
#include <ESP32Servo.h>

#include "secrets.h"

Adafruit_VL53L0X lox;
Servo servo;
WebServer server(80);

// ------------------- Pins -------------------
const int SERVO_PIN = 25;

// ---------------- Servo Angles --------------
const int SERVO_RELEASE = 0;
const int SERVO_PRESS = 140;

// -------- Bottle Detection Threshold --------
const int BOTTLE_THRESHOLD = 150; // mm

// ----- Time for servo to finish moving ------
const int SERVO_MOVE_TIME = 500; // milliseconds

// ---------- Wi-Fi Recovery Timing -----------
const unsigned long WIFI_CONNECT_TIMEOUT = 20000;       // milliseconds
const unsigned long WIFI_RECONNECT_INTERVAL = 5000;     // milliseconds
const unsigned long WIFI_RESTART_AFTER = 120000;        // milliseconds

bool bottleDetected = false;
bool dispensing = false;

int lastDistanceMm = -1;
unsigned long startTime = 0;
unsigned long lastSensorRead = 0;
unsigned long wifiDisconnectedSince = 0;
unsigned long lastWifiReconnectAttempt = 0;

void sendCorsHeaders()
{
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void sendJson(int statusCode, String body)
{
    sendCorsHeaders();
    server.send(statusCode, "application/json", body);
}

void handleOptions()
{
    sendCorsHeaders();
    server.send(204, "text/plain", "");
}

void readBottleSensor()
{
    VL53L0X_RangingMeasurementData_t measure;
    lox.rangingTest(&measure, false);

    if (measure.RangeStatus == 4)
    {
        lastDistanceMm = -1;
        bottleDetected = false;
        return;
    }

    lastDistanceMm = measure.RangeMilliMeter;
    bottleDetected = lastDistanceMm > 0 && lastDistanceMm < BOTTLE_THRESHOLD;
}

void releaseServo()
{
    if (!servo.attached())
    {
        servo.attach(SERVO_PIN, 500, 2400);
    }

    servo.write(SERVO_RELEASE);
    dispensing = false;
}

void pressServo()
{
    if (!servo.attached())
    {
        servo.attach(SERVO_PIN, 500, 2400);
        delay(50);
    }

    servo.write(SERVO_RELEASE);
    delay(80);

    for (int attempt = 0; attempt < 3; attempt++)
    {
        servo.write(SERVO_PRESS);
        delay(120);
    }
}

String statusJson()
{
    unsigned long elapsedMs = dispensing ? millis() - startTime : 0;

    String body = "{";
    body += "\"bottleDetected\":";
    body += bottleDetected ? "true" : "false";
    body += ",\"distanceMm\":";
    body += String(lastDistanceMm);
    body += ",\"dispensing\":";
    body += dispensing ? "true" : "false";
    body += ",\"elapsedMs\":";
    body += String(elapsedMs);
    body += "}";

    return body;
}

void handleStatus()
{
    readBottleSensor();
    sendJson(200, statusJson());
}

void handleStartFill()
{
    readBottleSensor();

    if (!bottleDetected)
    {
        sendJson(409, "{\"ok\":false,\"error\":\"No bottle detected within 150mm\"}");
        return;
    }

    if (dispensing)
    {
        sendJson(200, statusJson());
        return;
    }

    Serial.println("UI requested fill. Pressing servo...");
    pressServo();
    delay(SERVO_MOVE_TIME);

    startTime = millis();
    dispensing = true;

    sendJson(200, "{\"ok\":true,\"dispensing\":true,\"message\":\"Servo pressed\"}");
}

void handleStopFill()
{
    unsigned long elapsedMs = dispensing ? millis() - startTime : 0;

    Serial.println("UI requested stop. Releasing servo...");
    releaseServo();

    String body = "{\"ok\":true,\"elapsedMs\":";
    body += String(elapsedMs);
    body += "}";

    sendJson(200, body);
}

void connectWifi()
{
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Connecting to Wi-Fi");
    unsigned long connectStartedAt = millis();

    while (WiFi.status() != WL_CONNECTED && millis() - connectStartedAt < WIFI_CONNECT_TIMEOUT)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();

    if (WiFi.status() == WL_CONNECTED)
    {
        wifiDisconnectedSince = 0;
        Serial.print("Connected. ESP32 IP: ");
        Serial.println(WiFi.localIP());
    }
    else
    {
        wifiDisconnectedSince = millis();
        Serial.println("Wi-Fi connect timed out. Will keep retrying in loop.");
    }
}

void maintainWifi()
{
    if (WiFi.status() == WL_CONNECTED)
    {
        if (wifiDisconnectedSince != 0)
        {
            wifiDisconnectedSince = 0;
            Serial.print("Wi-Fi reconnected. ESP32 IP: ");
            Serial.println(WiFi.localIP());
        }

        return;
    }

    if (wifiDisconnectedSince == 0)
    {
        wifiDisconnectedSince = millis();
        Serial.println("Wi-Fi disconnected.");

        if (dispensing)
        {
            Serial.println("Releasing servo because Wi-Fi disconnected.");
            releaseServo();
        }
    }

    if (millis() - wifiDisconnectedSince >= WIFI_RESTART_AFTER)
    {
        Serial.println("Wi-Fi recovery timed out. Restarting ESP32...");
        delay(100);
        ESP.restart();
    }

    if (millis() - lastWifiReconnectAttempt >= WIFI_RECONNECT_INTERVAL)
    {
        lastWifiReconnectAttempt = millis();
        Serial.println("Retrying Wi-Fi connection...");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
}

void setup()
{
    Serial.begin(115200);
    Wire.begin(21, 22);

    Serial.println("Initializing VL53L0X...");

    if (!lox.begin())
    {
        Serial.println("Failed to initialize VL53L0X");
        while (1);
    }

    Serial.println("VL53L0X Ready");

    servo.setPeriodHertz(50);
    servo.attach(SERVO_PIN, 500, 2400);
    servo.write(SERVO_RELEASE);

    Serial.println("Servo Ready");

    connectWifi();

    server.on("/status", HTTP_GET, handleStatus);
    server.on("/status", HTTP_OPTIONS, handleOptions);
    server.on("/fill/start", HTTP_POST, handleStartFill);
    server.on("/fill/start", HTTP_OPTIONS, handleOptions);
    server.on("/fill/stop", HTTP_POST, handleStopFill);
    server.on("/fill/stop", HTTP_OPTIONS, handleOptions);

    server.begin();
    Serial.println("HTTP server ready");
}

void loop()
{
    maintainWifi();

    if (WiFi.status() == WL_CONNECTED)
    {
        server.handleClient();
    }

    if (millis() - lastSensorRead >= 100)
    {
        lastSensorRead = millis();
        readBottleSensor();

        Serial.print("Distance: ");
        Serial.print(lastDistanceMm);
        Serial.println(" mm");

        if (dispensing && !bottleDetected)
        {
            unsigned long elapsed = millis() - startTime;

            Serial.println("Bottle removed. Releasing servo...");
            Serial.print("Dispense Time: ");
            Serial.print(elapsed / 1000.0);
            Serial.println(" seconds");

            releaseServo();
        }
    }
}
