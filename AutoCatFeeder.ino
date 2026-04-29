#include <ESP32Servo.h>
#include "HX711.h"
#include <WiFi.h>
#include <HTTPClient.h>

// --- ตั้งค่า Wi-Fi และ Google Script ---
const char* ssid = "NETWORK UNAVAILABLE";
const char* password = "error404";     
String WebApp_URL = "https://script.google.com/macros/s/AKfycbz3jcOOxz99F3rDYj8HlucOtjieJXZNHgL1BLIbFYDaMfNQnIHdx0DTrhdm6zUvUpKEPA/exec"; // วาง URL ใหม่ที่เพิ่ง Deploy

#define TRIG_PIN 21
#define ECHO_PIN 18
#define TRIG_PIN2 26
#define ECHO_PIN2 25
#define DOUT 4  // DT
#define CLK 5   // SCK
#define SERVO_PIN 13

Servo myServo;
HX711 scale;
float calibration_factor = 1200.40;

bool fed = false;
bool isFeeding = false; 
bool waitingForConfirm = false; // ตัวแปรสำหรับรอการยืนยันเมื่อโควต้าเต็ม
unsigned long lastTimeDataSent = 0;
unsigned long timerDelay = 3000;    

void setup() {
  Serial.begin(115200);
  
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Connected!");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(TRIG_PIN2, OUTPUT);
  pinMode(ECHO_PIN2, INPUT);
  
  myServo.attach(SERVO_PIN);
  myServo.write(0);
  
  scale.begin(DOUT, CLK);
  scale.set_scale(calibration_factor);
  scale.tare();
}

// 1. ฟังก์ชันสำหรับส่ง Data และรับคำสั่งจาก Sheet กลับมา
String sendDataAndGetCommand(float fDist, float cDist, float w) {
  String command = "";
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = WebApp_URL + "?action=updateData&foodDist=" + String(fDist) + "&catDist=" + String(cDist) + "&weight=" + String(w);
    http.begin(url);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    
    int httpCode = http.GET();
    if (httpCode > 0) {
      command = http.getString();
      command.trim();
    }
    http.end();
  }
  return command;
}

// 2. ฟังก์ชันอัปเดตสถานะ ON/OFF ไปที่ B1
void updateServoStateToSheet(String state) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String url = WebApp_URL + "?action=updateServo&state=" + state;
    
    http.begin(url);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.GET();
    http.end();
  }
}

// 3. กระบวนการให้อาหาร 
void feedRoutine() {
  if(isFeeding) return;
  isFeeding = true;

  Serial.println("Feeding Started...");
  
  updateServoStateToSheet("ON");

  myServo.write(0);
  delay(1000);         
  myServo.write(60);
  delay(1500);
  myServo.write(0);
  delay(1000);
  
  updateServoStateToSheet("OFF");
  
  Serial.println("Feeding Finished.");
  fed = true;
  isFeeding = false;
}

void loop() {
  // อ่านค่าระยะอาหาร
  digitalWrite(TRIG_PIN2, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN2, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN2, LOW);
  float distance2 = pulseIn(ECHO_PIN2, HIGH) * 0.034 / 2;

  // อ่านค่าระยะแมว
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  float CatDistance = pulseIn(ECHO_PIN, HIGH) * 0.034 / 2;

  // อ่านน้ำหนัก
  float weight = scale.get_units(1);

  // --- 1. เงื่อนไขการให้อาหารแบบอัตโนมัติ (Sensor Trigger) ---
  if (CatDistance > 0 && CatDistance < 30 && weight < 2 && !fed && !waitingForConfirm) {
    
    // ถาม Sheet ก่อนว่าโควต้าเกินหรือยัง และเช็กว่า Auto Mode เปิดอยู่ไหม
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      String url = WebApp_URL + "?action=checkAutoFeed";
      http.begin(url);
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      int httpCode = http.GET();
      
      if (httpCode > 0) {
        String res = http.getString();
        res.trim();
        
        if (res == "AUTO_OFF") {
          Serial.println("Auto Mode is OFF. Sensor triggered but ignoring feed.");
          fed = true; // เซ็ตเป็น true เพื่อให้เครื่องหยุดส่ง Request รัวๆ จนกว่าแมวจะเดินออกไป
        } else if (res == "PENDING") {
          Serial.println("Quota reached! Waiting for confirmation on Web UI.");
          waitingForConfirm = true; 
        } else if (res == "ON") {
          feedRoutine();
        }
      }
      http.end();
    }
  } else if (CatDistance > 40) {
    fed = false;
    waitingForConfirm = false; // รีเซ็ตสถานะเมื่อแมวเดินออกไปนอกระยะ
  }

  // --- 2. การส่ง Data ทุก 3 วินาที + เช็กการสั่งการแบบ Manual จาก Sheet ---
  if ((millis() - lastTimeDataSent) > timerDelay) {
    
    // ส่งข้อมูลเซนเซอร์ และรับค่าจากช่อง B1 กลับมา
    String sheetCommand = sendDataAndGetCommand(distance2, CatDistance, weight);
    Serial.print("Sheet B1 State is: ");
    Serial.println(sheetCommand);

    // เช็กว่ามีการพิมพ์คำว่า "ON" ในช่อง B1 ของ Google Sheet หรือไม่ (Manual Trigger)
    if (sheetCommand == "ON" && !isFeeding) {
      Serial.println("Manual trigger activated from Google Sheets!");
      feedRoutine();
    }
    
    lastTimeDataSent = millis();
  }
}