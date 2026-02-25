const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const LEAD_MINUTES = 15;
const LOOKBACK_MINUTES = 8;
const LOOKAHEAD_MINUTES = 2;
const APP_URL = process.env.APP_URL || "http://localhost:5500";
const TEST_PUSH_SECRET = process.env.TEST_PUSH_SECRET || "";

function isValidDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeKey(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getOffsetMsAtEpoch(epochMs, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(new Date(epochMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - epochMs;
}

function getEpochForZonedDateTime(dueDate, dueTime, timeZone) {
  const [year, month, day] = dueDate.split("-").map((value) => Number(value));
  const [hour, minute] = dueTime.split(":").map((value) => Number(value));
  const targetUtcLike = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = targetUtcLike;
  for (let i = 0; i < 3; i += 1) {
    const offsetMs = getOffsetMsAtEpoch(guess, timeZone);
    const nextGuess = targetUtcLike - offsetMs;
    if (nextGuess === guess) break;
    guess = nextGuess;
  }
  return guess;
}

function getAppointmentTimestamp(dueDate, dueTime, timeZone = "UTC") {
  if (!isValidDateKey(dueDate) || !isValidTimeKey(dueTime)) return Number.NaN;
  const resolvedTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return getEpochForZonedDateTime(dueDate, dueTime, resolvedTimeZone);
}

function makeDispatchId(task) {
  const safeTaskId = encodeURIComponent(task.id || "unknown").replace(/%/g, "_");
  const safeDate = String(task.dueDate || "unknown");
  const safeTime = String(task.dueTime || "unknown").replace(":", "-");
  return `${safeTaskId}__${safeDate}__${safeTime}__${LEAD_MINUTES}`;
}

function getTokenValues(tokenDocs) {
  return tokenDocs
    .map((doc) => {
      const data = doc.data() || {};
      return typeof data.token === "string" && data.token ? data.token : doc.id;
    })
    .filter((token) => typeof token === "string" && token);
}

function buildReminderBody(task) {
  const timeText = isValidTimeKey(task.dueTime) ? task.dueTime : "scheduled time";
  return `${task.text || "Appointment"} starts in ${LEAD_MINUTES} minutes (${task.dueDate} ${timeText}).`;
}

exports.sendTestPush = onRequest(
  {
    region: "us-central1"
  },
  async (req, res) => {
    try {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "GET" && req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Use GET or POST." });
        return;
      }

      const params = req.method === "POST" ? req.body || {} : req.query || {};
      const userId = typeof params.userId === "string" ? params.userId.trim() : "";
      const secret = typeof params.secret === "string" ? params.secret : "";
      const targetToken = typeof params.targetToken === "string" ? params.targetToken.trim() : "";
      const clientUserAgent = typeof params.clientUserAgent === "string" ? params.clientUserAgent.trim() : "";
      const title = typeof params.title === "string" && params.title.trim() ? params.title.trim() : "Test appointment reminder";
      const body = typeof params.body === "string" && params.body.trim()
        ? params.body.trim()
        : "This is a test push from your Firebase Cloud Function.";

      if (!userId) {
        res.status(400).json({ ok: false, error: "Missing userId." });
        return;
      }

      if (TEST_PUSH_SECRET && secret !== TEST_PUSH_SECRET) {
        res.status(401).json({ ok: false, error: "Unauthorized." });
        return;
      }

      const userRef = db.collection("users").doc(userId);
      const tokenSnap = await userRef.collection("notificationTokens").get();
      const tokenDocs = tokenSnap.docs;
      const tokenEntries = tokenDocs
        .map((doc) => {
          const data = doc.data() || {};
          const token = typeof data.token === "string" && data.token ? data.token : doc.id;
          const userAgent = typeof data.userAgent === "string" ? data.userAgent : "";
          return { token, userAgent };
        })
        .filter((item) => item.token);
      const tokens = tokenEntries.map((item) => item.token);
      if (tokens.length === 0) {
        logger.warn("sendTestPush: no notification tokens", { userId });
        res.status(404).json({ ok: false, error: "No notification tokens found for user.", userId });
        return;
      }

      let tokensToSend = [];
      if (targetToken) {
        tokensToSend = tokens.filter((token) => token === targetToken);
      } else if (clientUserAgent) {
        tokensToSend = tokenEntries
          .filter((entry) => entry.userAgent === clientUserAgent)
          .map((entry) => entry.token);
      }

      if (tokensToSend.length === 0) {
        res.status(404).json({
          ok: false,
          error: targetToken
            ? "Target token not found for this user."
            : "No token matched this device session. Tap Phone alerts once, then retry Test push.",
          userId
        });
        return;
      }

      const message = {
        tokens: tokensToSend,
        notification: {
          title,
          body
        },
        data: {
          type: "test",
          url: APP_URL
        },
        webpush: {
          fcmOptions: {
            link: APP_URL
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      const failureCodes = response.responses
        .filter((itemResponse) => !itemResponse.success)
        .map((itemResponse) => (itemResponse.error && itemResponse.error.code ? itemResponse.error.code : "unknown"));

      const invalidTokenIndexes = [];
      response.responses.forEach((itemResponse, index) => {
        if (!itemResponse.success) {
          const code = itemResponse.error && itemResponse.error.code ? itemResponse.error.code : "";
          if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            invalidTokenIndexes.push(index);
          }
        }
      });

      if (invalidTokenIndexes.length > 0) {
        const invalidTokens = invalidTokenIndexes.map((index) => tokens[index]).filter(Boolean);
        for (const tokenDoc of tokenDocs) {
          const tokenData = tokenDoc.data() || {};
          const tokenValue = typeof tokenData.token === "string" && tokenData.token ? tokenData.token : tokenDoc.id;
          if (invalidTokens.includes(tokenValue)) {
            await tokenDoc.ref.delete();
          }
        }
      }

      logger.info("sendTestPush result", {
        userId,
        tokenCount: tokensToSend.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        failureCodes: Array.from(new Set(failureCodes)),
        removedInvalidTokenCount: invalidTokenIndexes.length
      });

      res.status(200).json({
        ok: true,
        userId,
        tokenCount: tokensToSend.length,
        successCount: response.successCount,
        failureCount: response.failureCount
      });
    } catch (error) {
      logger.error("sendTestPush failed", error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
);

exports.sendAppointmentReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    region: "us-central1"
  },
  async () => {
    const nowMs = Date.now();
    const windowStart = nowMs - LOOKBACK_MINUTES * 60 * 1000;
    const windowEnd = nowMs + LOOKAHEAD_MINUTES * 60 * 1000;
    logger.info("Reminder scheduler window", {
      nowIso: new Date(nowMs).toISOString(),
      windowStartIso: new Date(windowStart).toISOString(),
      windowEndIso: new Date(windowEnd).toISOString(),
      leadMinutes: LEAD_MINUTES
    });

    const usersSnap = await db.collection("users").get();
    let sentCount = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};
      const userTimeZone = isValidTimeZone(userData.timeZone) ? userData.timeZone : "UTC";
      const appointmentsRef = userDoc.ref.collection("todo").doc("appointments");
      const appointmentsSnap = await appointmentsRef.get();
      if (!appointmentsSnap.exists) {
        logger.info("Processed user reminders", {
          userId,
          userTimeZone,
          skipReason: "no_appointments_doc"
        });
        continue;
      }

      const data = appointmentsSnap.data() || {};
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      if (tasks.length === 0) {
        logger.info("Processed user reminders", {
          userId,
          userTimeZone,
          totalTasks: 0,
          skipReason: "no_tasks"
        });
        continue;
      }

      const tokenSnap = await userDoc.ref.collection("notificationTokens").get();
      const tokenDocs = tokenSnap.docs;
      const tokens = getTokenValues(tokenDocs);
      if (tokens.length === 0) {
        logger.info("Processed user reminders", {
          userId,
          userTimeZone,
          totalTasks: tasks.length,
          tokenCount: 0,
          skipReason: "no_tokens"
        });
        continue;
      }

      let validTimedTasks = 0;
      let inWindowTasks = 0;
      let nearestDeltaMinutes = null;

      for (const task of tasks) {
        if (!task || typeof task !== "object") continue;
        if (!isValidDateKey(task.dueDate) || !isValidTimeKey(task.dueTime)) continue;
        validTimedTasks += 1;

        const appointmentMs = getAppointmentTimestamp(task.dueDate, task.dueTime, userTimeZone);
        if (!Number.isFinite(appointmentMs)) continue;

        const triggerMs = appointmentMs - LEAD_MINUTES * 60 * 1000;
        const deltaMinutes = Math.round((triggerMs - nowMs) / 60000);
        if (nearestDeltaMinutes === null || Math.abs(deltaMinutes) < Math.abs(nearestDeltaMinutes)) {
          nearestDeltaMinutes = deltaMinutes;
        }
        if (triggerMs < windowStart || triggerMs > windowEnd) continue;
        inWindowTasks += 1;

        const dispatchId = makeDispatchId(task);
        const dispatchRef = userDoc.ref.collection("reminderDispatch").doc(dispatchId);
        const dispatchSnap = await dispatchRef.get();
        if (dispatchSnap.exists) continue;

        const message = {
          tokens,
          notification: {
            title: "Appointment reminder",
            body: buildReminderBody(task)
          },
          data: {
            appointmentId: String(task.id || ""),
            dueDate: String(task.dueDate || ""),
            dueTime: String(task.dueTime || ""),
            url: APP_URL
          },
          webpush: {
            fcmOptions: {
              link: APP_URL
            }
          }
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        const failureCodes = response.responses
          .filter((itemResponse) => !itemResponse.success)
          .map((itemResponse) => (itemResponse.error && itemResponse.error.code ? itemResponse.error.code : "unknown"));

        const invalidTokenIndexes = [];
        response.responses.forEach((itemResponse, index) => {
          if (!itemResponse.success) {
            const code = itemResponse.error && itemResponse.error.code ? itemResponse.error.code : "";
            if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
              invalidTokenIndexes.push(index);
            }
          }
        });

        if (invalidTokenIndexes.length > 0) {
          const invalidTokens = invalidTokenIndexes.map((index) => tokens[index]).filter(Boolean);
          for (const tokenDoc of tokenDocs) {
            const tokenData = tokenDoc.data() || {};
            const tokenValue = typeof tokenData.token === "string" && tokenData.token ? tokenData.token : tokenDoc.id;
            if (invalidTokens.includes(tokenValue)) {
              await tokenDoc.ref.delete();
            }
          }
        }

        logger.info("Scheduled reminder send result", {
          userId,
          appointmentId: String(task.id || ""),
          dueDate: String(task.dueDate || ""),
          dueTime: String(task.dueTime || ""),
          tokenCount: tokens.length,
          successCount: response.successCount,
          failureCount: response.failureCount,
          failureCodes: Array.from(new Set(failureCodes)),
          removedInvalidTokenCount: invalidTokenIndexes.length
        });

        if (response.successCount > 0) {
          sentCount += response.successCount;
          await dispatchRef.set({
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            appointmentId: String(task.id || ""),
            dueDate: String(task.dueDate || ""),
            dueTime: String(task.dueTime || ""),
            reminderLeadMinutes: LEAD_MINUTES,
            successCount: response.successCount,
            failureCount: response.failureCount
          });
        }
      }

      logger.info("Processed user reminders", {
        userId,
        userTimeZone,
        totalTasks: tasks.length,
        validTimedTasks,
        inWindowTasks,
        tokenCount: tokens.length,
        nearestTriggerDeltaMinutes: nearestDeltaMinutes
      });
    }

    logger.info("Reminder scheduler run complete", { sentCount });
  }
);
