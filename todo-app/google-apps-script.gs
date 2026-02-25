const CALENDAR_ID = "primary";
const SHARED_SECRET = "todoapp-9d6b7f31-4e2c-4d6b-9a34-78f205b31ce9";

function doGet(e) {
  try {
    const secret = (e && e.parameter && e.parameter.secret) || "";
    if (SHARED_SECRET && secret !== SHARED_SECRET) {
      return outputResponse({ ok: false, error: "Unauthorized request." }, e);
    }

    const action = (e && e.parameter && e.parameter.action) || "import";

    if (action === "sync") {
      const payloadText = (e && e.parameter && e.parameter.payload) || "{}";
      const payload = JSON.parse(payloadText);
      const sourceTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      const syncTasks = sourceTasks
        .filter((task) => task && typeof task.id === "string" && typeof task.text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || ""));
      const events = [];
      const warnings = [];

      syncTasks.forEach((task) => {
        try {
          events.push(upsertCalendarEvent(task));
        } catch (error) {
          warnings.push({ id: task.id, error: String(error) });
        }
      });

      return outputResponse({ ok: true, events: events, warnings: warnings }, e);
    }

    const days = Math.max(1, Math.min(365, Number((e && e.parameter && e.parameter.days) || 120)));
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 59);
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const calendarTimeZone = calendar ? calendar.getTimeZone() : Session.getScriptTimeZone();
    const events = calendar.getEvents(now, end).map((event) => ({
      googleEventId: event.getId(),
      text: event.getTitle(),
      dueDate: toDateKey(event, calendarTimeZone),
      dueTime: toTimeKey(event, calendarTimeZone),
      completed: false,
      priority: "medium"
    }));

    return outputResponse({ ok: true, events: events }, e);
  } catch (error) {
    return outputResponse({ ok: false, error: String(error) }, e);
  }
}

function doPost(e) {
  try {
    const payloadText = (e && e.parameter && e.parameter.payload) || "{}";
    const payload = JSON.parse(payloadText);

    if (SHARED_SECRET && payload.secret !== SHARED_SECRET) {
      return jsonOutput({ ok: false, error: "Unauthorized request." });
    }

    const sourceTasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    const syncTasks = sourceTasks
      .filter((task) => task && typeof task.id === "string" && typeof task.text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate || ""));
    const events = [];
    const warnings = [];

    syncTasks.forEach((task) => {
      try {
        events.push(upsertCalendarEvent(task));
      } catch (error) {
        warnings.push({ id: task.id, error: String(error) });
      }
    });

    return jsonOutput({ ok: true, events: events, warnings: warnings });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error) });
  }
}

function upsertCalendarEvent(task) {
  const hasExplicitTime = /^\d{2}:\d{2}$/.test(task.dueTime || "");
  const fallbackTimeKey = "09:00";
  const timeKey = hasExplicitTime ? task.dueTime : fallbackTimeKey;
  let startDate = createDateTimeForTimeZone(task.dueDate, timeKey, Session.getScriptTimeZone());
  let endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    throw new Error(`Calendar not found: ${CALENDAR_ID}`);
  }
  const calendarTimeZone = calendar.getTimeZone() || Session.getScriptTimeZone();

  startDate = createDateTimeForTimeZone(task.dueDate, timeKey, calendarTimeZone);
  endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const titlePrefix = task.completed ? "✅" : "📌";
  const title = `${titlePrefix} ${task.text}`;
  const description = `Priority: ${task.priority || "medium"}\nTask ID: ${task.id}`;
  let event;

  if (task.googleEventId) {
    try {
      event = calendar.getEventById(task.googleEventId);
    } catch {
      event = null;
    }
  }

  if (event) {
    try {
      if (!hasExplicitTime) {
        const existingStart = event.getStartTime();
        const existingEnd = event.getEndTime();
        const durationMs = Math.max(15 * 60 * 1000, existingEnd.getTime() - existingStart.getTime());
        const hour = String(existingStart.getHours()).padStart(2, "0");
        const minute = String(existingStart.getMinutes()).padStart(2, "0");
        startDate = createDateTimeForTimeZone(task.dueDate, hour + ":" + minute, calendarTimeZone);
        endDate = new Date(startDate.getTime() + durationMs);
      }

      const existingDateKey = toDateKey(event, calendarTimeZone);
      const existingTimeKey = toTimeKey(event, calendarTimeZone);
      const targetTimeKey = hasExplicitTime ? timeKey : existingTimeKey;
      const shouldUpdateTime = existingDateKey !== task.dueDate || existingTimeKey !== targetTimeKey;

      event.setTitle(title);
      event.setDescription(description);
      if (shouldUpdateTime) {
        event.setTime(startDate, endDate);
      }
    } catch (error) {
      const message = String(error || "");
      if (message.toLowerCase().includes("action not allowed")) {
        return {
          id: task.id,
          googleEventId: event.getId()
        };
      }
      throw error;
    }
  } else {
    event = calendar.createEvent(title, startDate, endDate, { description: description });
  }

  return {
    id: task.id,
    googleEventId: event.getId()
  };
}

function toDateKey(event, timeZone) {
  const sourceDate = event.isAllDayEvent() ? event.getAllDayStartDate() : event.getStartTime();
  return Utilities.formatDate(sourceDate, timeZone || Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function toTimeKey(event, timeZone) {
  const sourceDate = event.getStartTime();
  return Utilities.formatDate(sourceDate, timeZone || Session.getScriptTimeZone(), "HH:mm");
}

function createDateTimeForTimeZone(dateKey, timeKey, timeZone) {
  const tz = timeZone || Session.getScriptTimeZone();
  const safeDateKey = /^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")
    ? dateKey
    : Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const safeTimeKey = /^\d{2}:\d{2}$/.test(timeKey || "") ? timeKey : "09:00";

  const dateParts = safeDateKey.split("-").map((part) => Number(part));
  const timeParts = safeTimeKey.split(":").map((part) => Number(part));
  const y = dateParts[0];
  const m = dateParts[1] - 1;
  const d = dateParts[2];
  const hh = timeParts[0];
  const mm = timeParts[1];

  const asUtc = Date.UTC(y, m, d, hh, mm, 0, 0);
  const firstGuess = new Date(asUtc - parseOffsetMinutes(Utilities.formatDate(new Date(asUtc), tz, "Z")) * 60 * 1000);
  const correctedOffset = parseOffsetMinutes(Utilities.formatDate(firstGuess, tz, "Z"));
  return new Date(asUtc - correctedOffset * 60 * 1000);
}

function parseOffsetMinutes(offsetText) {
  const match = String(offsetText || "").match(/^([+-])(\d{2})(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function outputResponse(data, e) {
  const callback = (e && e.parameter && e.parameter.callback) || "";
  if (!callback) {
    return jsonOutput(data);
  }

  return ContentService
    .createTextOutput(`${callback}(${JSON.stringify(data)})`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
