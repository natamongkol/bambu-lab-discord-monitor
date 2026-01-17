const mqtt = require("mqtt");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// --- Configuration Load ---
let APP_CONFIG = {};
let PRINTERS = [];

try {
  const rawConfig = fs.readFileSync("config.json");
  APP_CONFIG = JSON.parse(rawConfig);
  if (!APP_CONFIG.webhookUrl || !APP_CONFIG.printers)
    throw new Error("Invalid Config Structure");
  PRINTERS = APP_CONFIG.printers;
} catch (e) {
  console.error(`[FATAL] Config Error: ${e.message}`);
  process.exit(1);
}

// --- GLOBAL STATE CACHE ---
const PRINTER_STATES = {};

// Function: Save Debug Log
function saveDebugLog(printerName, eventType, rawJson) {
  if (APP_CONFIG.saveLog !== true) return;

  try {
    const logDir = "./logs";
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = printerName.replace(/[^a-z0-9]/gi, "_");
    const filename = path.join(
      logDir,
      `${safeName}_${eventType}_${timestamp}.json`
    );
    fs.writeFileSync(filename, JSON.stringify(rawJson, null, 2));
    console.log(`[DEBUG] 💾 Saved log: ${filename}`);
  } catch (err) {
    console.error(`[DEBUG] Failed to save log: ${err.message}`);
  }
}

// --- Helper Functions ---

function getFanSpeed(val) {
  const v = parseInt(val || 0);
  if (v === 0) return "OFF";
  return `Lvl ${v}`;
}

// Update State Function (Merge Data)
function updateState(serial, newData) {
  if (!PRINTER_STATES[serial]) {
    PRINTER_STATES[serial] = {};
  }
  if (newData.print) {
    PRINTER_STATES[serial] = {
      ...PRINTER_STATES[serial],
      ...newData.print,
      ams: newData.print.ams || PRINTER_STATES[serial].ams,
      subtask_name:
        newData.print.subtask_name ||
        newData.print.gcode_file ||
        PRINTER_STATES[serial].subtask_name ||
        "Unknown File",
    };
  }
  return PRINTER_STATES[serial];
}

// --- Monitor Function ---
function startMonitor(printerConfig, globalWebhook) {
  console.log(`[INIT] Initializing monitor for: ${printerConfig.name}`);

  let lastState = "UNKNOWN";
  let lastErrorCode = 0;
  let isFirstLoad = true;

  const client = mqtt.connect(`mqtts://${printerConfig.host}:8883`, {
    username: "bblp",
    password: printerConfig.accessCode,
    rejectUnauthorized: false,
    connectTimeout: 10000,
  });

  const requestFullData = () => {
    client.publish(
      `device/${printerConfig.serial}/request`,
      JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } })
    );
  };

  client.on("error", (err) => {
    console.error(
      `[ERR] ${printerConfig.name}: Connection failed - ${err.message}`
    );
    client.end();
  });

  client.on("connect", () => {
    console.log(`[CONN] ${printerConfig.name}: Connected.`);
    client.subscribe(`device/${printerConfig.serial}/report`);
    requestFullData();
  });

  client.on("message", async (topic, message) => {
    try {
      const json = JSON.parse(message.toString());
      if (!json.print || !json.print.gcode_state) return;

      const p = updateState(printerConfig.serial, json);
      const currentState = p.gcode_state;
      const errorCode = Number(p.mc_print_error_code || 0);

      // --- EVENT TRIGGERS ---

      // 🟢 1. STARTUP
      if (isFirstLoad) {
        console.log(`[INFO] ${printerConfig.name}: Monitor system started.`);
        saveDebugLog(printerConfig.name, "STARTUP", p);
        await sendWebhook(printerConfig.name, globalWebhook, p, "STARTUP");

        isFirstLoad = false;
        lastState = currentState;
        lastErrorCode = errorCode;
        return;
      }

      // 🟡 2. START PRINTING (IDLE -> RUNNING)
      if (lastState !== "RUNNING" && currentState === "RUNNING") {
        console.log(
          `[JOB] ${printerConfig.name}: Print detected. Requesting full details...`
        );
        requestFullData();

        setTimeout(async () => {
          const freshData = PRINTER_STATES[printerConfig.serial];
          saveDebugLog(printerConfig.name, "START", freshData);
          await sendWebhook(
            printerConfig.name,
            globalWebhook,
            freshData,
            "START"
          );
        }, 2500);
      }

      // 🔴 3. ERROR
      if (errorCode !== 0 && errorCode !== lastErrorCode) {
        console.log(`[WARN] ${printerConfig.name}: Error detected.`);
        saveDebugLog(printerConfig.name, "ERROR", p);
        await sendWebhook(
          printerConfig.name,
          globalWebhook,
          p,
          "ERROR",
          errorCode
        );
        lastErrorCode = errorCode;
      } else if (errorCode === 0) {
        lastErrorCode = 0;
      }

      // 🟢 4. FINISH (RUNNING -> FINISH)
      if (lastState === "RUNNING" && currentState === "FINISH") {
        console.log(
          `[JOB] ${printerConfig.name}: Print finished. Requesting full details...`
        );
        requestFullData();

        setTimeout(async () => {
          const freshData = PRINTER_STATES[printerConfig.serial];
          saveDebugLog(printerConfig.name, "FINISH", freshData);
          await sendWebhook(
            printerConfig.name,
            globalWebhook,
            freshData,
            "FINISH"
          );
        }, 2500);
      }

      lastState = currentState;
    } catch (err) {
      console.error(
        `[ERR] ${printerConfig.name}: Processing error - ${err.message}`
      );
    }
  });
}

// --- Universal Webhook Builder ---
async function sendWebhook(printerName, url, data, type, errCode = 0) {
  let embed = {};
  const timestamp = new Date().toISOString();

  // Basic Data
  const currentState = data.gcode_state || "UNKNOWN";
  const progress = data.mc_percent || 0;
  const remaining = data.mc_remaining_time || 0;
  const filename = data.subtask_name || "Unknown File";
  const layer = `${data.layer_num || 0} / ${data.total_layer_num || 0}`;
  const speed = data.spd_lvl ? `Lvl ${data.spd_lvl}` : "N/A";

  // ETA Logic
  let progressStr = `**${progress}%**`;
  if (currentState === "RUNNING") {
    if (remaining > 0) {
      const etaDate = new Date(Date.now() + remaining * 60000);
      const etaStr = etaDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      progressStr += ` (ETA: ${etaStr})`;
    } else {
      progressStr += ` (Calc...)`;
    }
  } else {
    progressStr += ` (${currentState})`;
  }

  // Fields
  const fieldFile = {
    name: "📂 Filename",
    value: `\`${filename}\``,
    inline: false,
  };
  const fieldProgress = {
    name: "⏳ Progress",
    value: progressStr,
    inline: true,
  };
  const fieldLayer = {
    name: "🥞 Layer / Speed",
    value: `${layer}\n${speed}`,
    inline: true,
  };
  const fieldStatus = {
    name: "📊 Status",
    value: `**${currentState}**`,
    inline: true,
  };

  // Smart Hardware Field
  const nozzle = `${data.nozzle_diameter || "?"}mm (${
    data.nozzle_type || "?"
  })`;
  let hardwareStr = `Nozzle: ${nozzle}`;

  if (currentState === "RUNNING" || currentState === "PAUSE") {
    hardwareStr += `\nSrc: ${data.print_type || "N/A"}`;
  }

  const fieldHardware = {
    name: "⚙️ Hardware",
    value: hardwareStr,
    inline: true,
  };

  // Thermals
  const tNoz = `${data.nozzle_temper || 0}°C / ${
    data.nozzle_target_temper || 0
  }°C`;
  const tBed = `${data.bed_temper || 0}°C / ${data.bed_target_temper || 0}°C`;
  const fieldThermals = {
    name: "🌡️ Thermals",
    value: `**Noz:** ${tNoz}\n**Bed:** ${tBed}`,
    inline: true,
  };

  // AMS
  let amsBody = "No AMS Detected";
  let amsTitle = "📦 AMS System";
  if (data.ams && data.ams.ams && data.ams.ams[0]) {
    const ams = data.ams.ams[0];
    if (ams.temp)
      amsTitle += ` (Temp: ${ams.temp}°C | Hum: Lvl ${ams.humidity})`;

    if (ams.tray) {
      amsBody = ams.tray
        .map((t, i) => {
          const type = t.tray_type || "Empty";
          if (type === "Empty") return `\`S${i + 1}\` Empty`;
          const hex = t.tray_color ? `#${t.tray_color.slice(0, 6)}` : "N/A";
          const active = t.id == data.ams.tray_now ? "◀ **IN USE**" : "";
          return `\`S${i + 1}\` **${type}** [${hex}] ${active}`;
        })
        .join("\n");
    }
  }
  const fieldAMS = { name: amsTitle, value: amsBody, inline: false };

  switch (type) {
    case "STARTUP":
      embed = {
        title: `🔵 System Online: ${printerName}`,
        color: 3447003, // Blue
        fields: [fieldStatus, fieldProgress, fieldHardware, fieldAMS],
      };
      break;
    case "START":
      embed = {
        title: `🟡 Print Started: ${printerName}`,
        color: 16776960, // Yellow
        description: `New job initiated.`,
        fields: [
          fieldFile,
          fieldProgress,
          fieldHardware,
          fieldThermals,
          fieldAMS,
        ],
      };
      break;
    case "FINISH":
      embed = {
        title: `🟢 Print Completed: ${printerName}`,
        color: 5763719, // Green
        description: `Job finished successfully.`,
        fields: [
          fieldFile,
          {
            name: "⏱️ Final Status",
            value: "✅ COMPLETED (100%)",
            inline: true,
          },
          fieldThermals,
          fieldAMS,
        ],
      };
      break;
    case "ERROR":
      embed = {
        title: `🔴 Critical Error: ${printerName}`,
        color: 15158332, // Red
        description: `**Please check the printer immediately.**`,
        fields: [fieldFile, fieldProgress],
      };
      break;
  }

  embed.footer = { text: "Bambu Lab Discord Monitor" };
  embed.timestamp = timestamp;

  try {
    await axios.post(url, { embeds: [embed] });
    console.log(`[WEBHOOK] Sent ${type} for ${printerName}`);
  } catch (e) {
    console.error(`[ERR] Webhook failed: ${e.message}`);
  }
}

// Start
console.log(`[INIT] Loading config... Found ${PRINTERS.length} printers.`);
PRINTERS.forEach((p) => startMonitor(p, APP_CONFIG.webhookUrl));
