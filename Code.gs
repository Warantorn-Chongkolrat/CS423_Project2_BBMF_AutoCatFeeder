const GEMINI_API_KEY = "AIzaSyAajLMhYpIm0MdvAYw_U82t6Q1Hjqhqbig";

function doGet(e) {
  if (!e.parameter.action) {
    return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('Auto Cat Feeder')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1"); 
  var action = e.parameter.action;

  if (action == "updateData") {
    var date = Utilities.formatDate(new Date(), "GMT+7", "MM/dd/yyyy HH:mm:ss");
    sheet.appendRow([date, e.parameter.foodDist, e.parameter.catDist, e.parameter.weight]);
  } 
  else if (action == "updateServo") {
    var state = e.parameter.state;
    var currentState = sheet.getRange("B1").getValue();
    sheet.getRange("B1").setValue(state); 
    
    if (state == "ON" && currentState != "ON") {
      updatePortions(sheet);
    }
  }
  else if (action == "checkAutoFeed") {
    // เช็กสถานะ Auto Mode ที่ช่อง D1 ก่อน
    var autoMode = sheet.getRange("D1").getValue() || "ON";
    if (autoMode === "OFF") {
      return ContentService.createTextOutput("AUTO_OFF"); // ส่งกลับไปบอก ESP32 ว่าปิดโหมดออโต้
    }

    var todayStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
    var portions = 0;
    
    var lastDateRaw = sheet.getRange("B3").getValue();
    var lastDateStr = lastDateRaw ? Utilities.formatDate(new Date(lastDateRaw), "GMT+7", "yyyy-MM-dd") : "";
    if (lastDateStr === todayStr) {
      portions = Number(sheet.getRange("B2").getValue()) || 0;
    }

    var profileSheet = ss.getSheetByName("CatProfile");
    var quotaVal = (profileSheet && profileSheet.getLastRow() >= 2) ? profileSheet.getRange(2, 8).getValue() : "-";
    
    if (quotaVal !== "-" && portions >= Number(quotaVal)) {
      sheet.getRange("B4").setValue("PENDING_AUTO"); 
      return ContentService.createTextOutput("PENDING");
    } else {
      return ContentService.createTextOutput("ON"); 
    }
  }
  
  var command = sheet.getRange("B1").getValue();
  return ContentService.createTextOutput(command);
}

function updatePortions(sheet) {
  var todayStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
  var lastDateRaw = sheet.getRange("B3").getValue();
  var lastDateStr = "";
  
  if (lastDateRaw) {
    try {
      lastDateStr = Utilities.formatDate(new Date(lastDateRaw), "GMT+7", "yyyy-MM-dd");
    } catch(e) {
      lastDateStr = String(lastDateRaw);
    }
  }

  var currentPortions = Number(sheet.getRange("B2").getValue()) || 0;
  
  if (lastDateStr === todayStr) {
    sheet.getRange("B2").setValue(currentPortions + 1);
  } else {
    sheet.getRange("B2").setValue(1);
    sheet.getRange("B3").setValue(todayStr);
  }
}

function updateServoFromWeb(state) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1");
  var currentState = sheet.getRange("B1").getValue();
  
  sheet.getRange("B1").setValue(state);
  if (state == "ON" && currentState != "ON") {
    updatePortions(sheet);
  }
  return "Success";
}

// ฟังก์ชันสำหรับเปิด-ปิด Auto Mode จากหน้าเว็บ
function updateAutoModeFromWeb(state) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1");
  sheet.getRange("D1").setValue(state);
  return "Success";
}

function getLatestData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1");
  var lastRow = sheet.getLastRow();
  var servoState = sheet.getRange("B1").getValue();
  var pendingConfirmState = sheet.getRange("B4").getValue(); 
  
  // ดึงสถานะ Auto Mode จาก D1 (ถ้าว่างให้เป็น ON)
  var autoModeState = sheet.getRange("D1").getValue() || "ON"; 
  
  var todayStr = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
  var lastDateRaw = sheet.getRange("B3").getValue();
  var lastDateStr = "";
  
  if (lastDateRaw) {
    try {
      lastDateStr = Utilities.formatDate(new Date(lastDateRaw), "GMT+7", "yyyy-MM-dd");
    } catch(e) {
      lastDateStr = String(lastDateRaw);
    }
  }
  
  var portions = 0;
  if (lastDateStr === todayStr) {
    portions = Number(sheet.getRange("B2").getValue()) || 0;
  }
  
  var profileData = {
    weight: "", gender: "Male", neutered: "Yes", bcs: 5, foodCal: "", recCal: "-", quota: "-"
  };
  
  var profileSheet = ss.getSheetByName("CatProfile");
  if (profileSheet && profileSheet.getLastRow() >= 2) {
    var vals = profileSheet.getRange(2, 2, 1, 7).getValues()[0];
    profileData.weight = vals[0];
    profileData.gender = vals[1];
    profileData.neutered = vals[2];
    profileData.bcs = vals[3];
    profileData.foodCal = vals[4];
    profileData.recCal = vals[5] || "-";
    profileData.quota = vals[6] || "-";
  }

  var data = { 
    time: "-", foodDist: 0, catDist: 0, weight: 0, 
    servo: servoState, 
    autoMode: autoModeState, // ส่งสถานะ Auto Mode ไปที่หน้าเว็บ
    portions: portions,
    pendingConfirm: pendingConfirmState,
    profile: profileData
  };

  if (lastRow >= 4) {
    var rangeStart = Math.max(4, lastRow - 20);
    var numRows = lastRow - rangeStart + 1;
    if (numRows > 0) {
      var rows = sheet.getRange(rangeStart, 1, numRows, 4).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i][1] !== "" && !isNaN(rows[i][1])) {
          data.time = Utilities.formatDate(new Date(rows[i][0]), "GMT+7", "HH:mm:ss");
          data.foodDist = rows[i][1];
          data.catDist = rows[i][2];
          data.weight = rows[i][3];
          break;
        }
      }
    }
  }
  return data;
}

// ฟังก์ชันสำหรับรับข้อมูล Cat Profile จากหน้าเว็บมาบันทึก
function saveCatProfile(profileData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("CatProfile");
  if (!sheet) {
    sheet = ss.insertSheet("CatProfile");
    sheet.appendRow([
      "Date Time", "Weight (kg)", "Gender", "Neutered", "Body Condition Score", 
      "Food Calories/g", "Recommended Calories/day", "Daily Food Quota (Portions)"
    ]);
    sheet.getRange("A1:H1").setFontWeight("bold");
  }
  
  var aiAnalysis = callGeminiAPI(profileData);
  var date = Utilities.formatDate(new Date(), "GMT+7", "MM/dd/yyyy HH:mm:ss");
  
  var rowData = [
    date, profileData.weight, profileData.gender, profileData.neutered, profileData.bcs,
    profileData.foodCal, aiAnalysis.recommended_calories, aiAnalysis.daily_portions        
  ];

  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 1, 1, 8).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }
  
  
    return " Profile saved! AI recommends " + aiAnalysis.recommended_calories + " kcal/day (" + aiAnalysis.daily_portions + " portions).";
  
}

function callGeminiAPI(data) {
  var gramsPerPortion = 10;
  
  // ตั้งค่า Default ดักไว้ตามที่คุณต้องการ
  var default_cal = 250;
  var default_portions = 5;

  var prompt = "You are a veterinary nutritionist. Analyze this cat profile: " +
               "Weight: " + data.weight + " kg, Gender: " + data.gender + 
               ", Neutered: " + data.neutered + ", Body Condition Score (1-9): " + data.bcs + 
               ". The food has " + data.foodCal + " kcal per gram. " +
               "Calculate the recommended daily calories (DER) for this cat based on standard veterinary formulas. " +
               "Then divide this by the food's kcal/gram to get total daily grams. " +
               "Finally, divide the total grams by " + gramsPerPortion + " to get the daily number of portions. " +
               "Return ONLY a valid JSON object with no markdown in this exact format: " +
               "{\"recommended_calories\": 250, \"daily_portions\": 5}";

  var url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY;
  var payload = { "contents": [{"parts": [{"text": prompt}]}] };
  var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    
    // 1. ถ้า Google API ส่ง Error เรื่อง High Demand หรือ API Key กลับมา
    if (json.error) {
      return { recommended_calories: default_cal, daily_portions: default_portions, is_error: true };
    }
    
    var aiText = json.candidates[0].content.parts[0].text.trim().replace(/```json/g, "").replace(/```/g, "").trim();
    var resultData = JSON.parse(aiText);
    
    var finalCal = Math.round(resultData.recommended_calories);
    var finalPortion = Math.round(resultData.daily_portions);
    
    // 2. ป้องกันกรณีที่ AI ตอบเป็นอย่างอื่นที่ไม่ใช่ตัวเลข (เช่น พิมพ์ข้อความคำอธิบายแถมมา)
    if (isNaN(finalCal) || isNaN(finalPortion)) {
      return { recommended_calories: default_cal, daily_portions: default_portions, is_error: true };
    }
    
    // ถ้าผ่านเงื่อนไขทั้งหมด แสดงว่าข้อมูลปกติ
    return { recommended_calories: finalCal, daily_portions: finalPortion, is_error: false };
    
  } catch(e) {
    // 3. กรณีระบบรันพัง เช่น เน็ตเวิร์คหลุด หรือแปลง JSON ไม่ผ่าน ให้ใช้ Default
    return { recommended_calories: default_cal, daily_portions: default_portions, is_error: true };
  }
}

function clearPendingState() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sheet1");
  sheet.getRange("B4").clearContent();
}