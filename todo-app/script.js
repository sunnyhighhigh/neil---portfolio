const STORAGE_KEY = "task-pilot-v1";
const THEME_KEY = "task-pilot-theme";
const VIEW_KEY = "task-pilot-view";
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzu484sC23YRAFA7XB0RGEvJaF7-U0i87gLPM8oQhTQtoEH4Xw3FwVY28bWHAgOyMLo2A/exec";
const GAS_SHARED_SECRET = "todoapp-9d6b7f31-4e2c-4d6b-9a34-78f205b31ce9";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBPjbMUgNrOpDf5V_S0orkTO4WThSTLhV8",
  authDomain: "appointment-a11f2.firebaseapp.com",
  projectId: "appointment-a11f2",
  storageBucket: "appointment-a11f2.firebasestorage.app",
  messagingSenderId: "569597186805",
  appId: "1:569597186805:web:10dfe4014bff0fbd86ebbc"
};
const FCM_VAPID_KEY = "BA21mbihqd41ExjBw_RNGSEd4k7rSl4LU2_aZxnMngPXv7VVDF8XFo9odnuG7EIIWxlXHE-4EdRRpB6G_FwBjFc";
const FIRESTORE_USERS_COLLECTION = "users";
const FIRESTORE_TODO_COLLECTION = "todo";
const FIRESTORE_TODO_DOC_ID = "appointments";
const COMPLETION_GRACE_MINUTES = 10;
const TEST_PUSH_FUNCTION_URL = "https://us-central1-appointment-a11f2.cloudfunctions.net/sendTestPush";
const TEST_PUSH_SECRET = "";
const PROJECT_FOLDER_PATH = "C:/Users/neilm/OneDrive/Documents/TODO app";
const IS_LOCAL_DEV = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const READ_ONLY_MODE = new URLSearchParams(window.location.search).get("readonly") === "1" || !IS_LOCAL_DEV;
const TASK_TEXT_BLOCKLIST = new Set([
  "start course",
  "submit assignment",
  "do assignment"
]);

const sortSelect = document.getElementById("sort-select");
const list = document.getElementById("todo-list");
const calendarSection = document.querySelector(".calendar-section");
const controlsSection = document.querySelector(".controls");
const viewListBtn = document.getElementById("view-list");
const viewCalendarBtn = document.getElementById("view-calendar");
const itemsLeft = document.getElementById("items-left");
const themeToggleBtn = document.getElementById("theme-toggle");
const phoneAlertsBtn = document.getElementById("enable-phone-alerts");
const deleteCompletedNowBtn = document.getElementById("delete-completed-now");
const syncGoogleCalendarBtn = document.getElementById("sync-google-calendar");
const importOnlyGoogleBtn = document.getElementById("import-only-google");
const testPushNowBtn = document.getElementById("test-push-now");
const refreshAppBtn = document.getElementById("refresh-app");
const runLocallyBtn = document.getElementById("run-locally");
const openVsCodeFolderBtn = document.getElementById("open-vscode-folder");
const testGasConnectionBtn = document.getElementById("test-gas-connection");
const authToggleBtn = document.getElementById("auth-toggle");
const syncStatus = document.getElementById("sync-status");
const authStatus = document.getElementById("auth-status");
const cloudStatus = document.getElementById("cloud-status");
const lastSyncStatus = document.getElementById("last-sync-status");
const calendarPrevBtn = document.getElementById("calendar-prev");
const calendarNextBtn = document.getElementById("calendar-next");
const calendarMonthLabel = document.getElementById("calendar-month-label");
const calendarGrid = document.getElementById("calendar-grid");
const calendarSelectedLabel = document.getElementById("calendar-selected-label");
const calendarSelectedList = document.getElementById("calendar-selected-list");
const rangeButtons = document.querySelectorAll(".range-btn");
const itemTemplate = document.getElementById("todo-item-template");

let tasks = loadTasks();
let activeRange = "all";
let sortMode = "due-asc";
let activeView = "list";
let currentCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = "";
let cloudEnabled = false;
let isApplyingCloudSnapshot = false;
let cloudSyncTimer = 0;
let cloudDocRef = null;
let cloudUnsubscribe = null;
let firebaseAppRef = null;
let firebaseDbRef = null;
let firebaseAuthRef = null;
let firebaseMessagingRef = null;
let currentNotificationToken = "";

function isReadOnlyMode() {
  return READ_ONLY_MODE;
}

function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

selectedCalendarDate = toLocalDateKey(new Date());

function isValidDueDate(value) {
  if (typeof value !== "string" || value === "") return false;
  const time = new Date(`${value}T00:00:00`).getTime();
  return !Number.isNaN(time);
}

function normalizeDueTime(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const hhmShort = trimmed.match(/^([0-9]|1\d|2[0-3]):([0-5]\d)$/);
  if (hhmShort) return `${String(Number(hhmShort[1])).padStart(2, "0")}:${hhmShort[2]}`;

  const hhmm = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (hhmm) return `${hhmm[1]}:${hhmm[2]}`;

  const hhmmss = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (hhmmss) return `${hhmmss[1]}:${hhmmss[2]}`;

  const ampm = trimmed.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (ampm) {
    const rawHour = Number(ampm[1]);
    const minute = ampm[2];
    if (rawHour >= 1 && rawHour <= 12) {
      const isPm = ampm[3].toUpperCase() === "PM";
      const hour24 = (rawHour % 12) + (isPm ? 12 : 0);
      return `${String(hour24).padStart(2, "0")}:${minute}`;
    }
  }

  const isoTime = trimmed.match(/T(\d{2}):(\d{2})/);
  if (isoTime) return `${isoTime[1]}:${isoTime[2]}`;

  return "";
}

function isValidDueTime(value) {
  return normalizeDueTime(value) !== "";
}

function isAppointmentCompleted(task) {
  if (!isValidDueDate(task?.dueDate)) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDayMs = new Date(`${task.dueDate}T00:00:00`).getTime();
  if (!Number.isFinite(dueDayMs)) return false;

  if (dueDayMs < today.getTime()) return true;

  if (!isValidDueTime(task?.dueTime)) return false;
  const normalizedTime = normalizeDueTime(task.dueTime);
  const appointmentMs = new Date(`${task.dueDate}T${normalizedTime}:00`).getTime();
  if (!Number.isFinite(appointmentMs)) return false;
  return Date.now() >= appointmentMs + (COMPLETION_GRACE_MINUTES * 60 * 1000);
}

function removeCompletedAppointments(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((task) => !isAppointmentCompleted(task));
}

function isCompletedForImmediateDelete(task) {
  if (!isValidDueDate(task?.dueDate)) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDayMs = new Date(`${task.dueDate}T00:00:00`).getTime();
  if (!Number.isFinite(dueDayMs)) return false;

  if (dueDayMs < today.getTime()) return true;
  if (dueDayMs > today.getTime()) return false;

  const normalized = normalizeDueTime(task?.dueTime || "");
  if (!normalized) return true;

  const now = new Date();
  const [hour, minute] = normalized.split(":").map((value) => Number(value));
  const dueMinutes = (hour * 60) + minute;
  const nowMinutes = (now.getHours() * 60) + now.getMinutes();
  return nowMinutes >= dueMinutes;
}

function removeCompletedAppointmentsImmediately(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((task) => !isCompletedForImmediateDelete(task));
}

function normalizeTask(task) {
  if (!task || typeof task !== "object") return null;
  if (typeof task.id !== "string" || typeof task.text !== "string") return null;

  const createdAt = typeof task.createdAt === "number" ? task.createdAt : Date.now();
  const dueDate = isValidDueDate(task.dueDate) ? task.dueDate : "";
  const dueTime = normalizeDueTime(task.dueTime || task.time || task.startTime || task.startDateTime || "");

  return {
    id: task.id,
    text: task.text.trim(),
    createdAt,
    dueDate,
    dueTime,
    googleEventId: typeof task.googleEventId === "string" ? task.googleEventId : ""
  };
}

function playReminderTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const audioContext = new AudioContextClass();
  const sequence = [0, 260, 520];

  sequence.forEach((delay) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.001;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + delay / 1000);
    gainNode.gain.exponentialRampToValueAtTime(0.35, audioContext.currentTime + delay / 1000 + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + delay / 1000 + 0.2);
    oscillator.stop(audioContext.currentTime + delay / 1000 + 0.22);
  });

  window.setTimeout(() => {
    if (audioContext.state !== "closed") {
      audioContext.close();
    }
  }, 1200);
}

async function ensureNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function dedupeTasks(items) {
  if (!Array.isArray(items)) return [];

  const bestByKey = new Map();

  const scoreTask = (task) => {
    let score = 0;
    if (task.googleEventId) score += 4;
    if (isValidDueDate(task.dueDate)) score += 2;
    if (isValidDueTime(task.dueTime)) score += 1;
    return score;
  };

  items.forEach((rawTask) => {
    const task = normalizeTask(rawTask);
    if (!task || !task.text) return;

    const normalizedText = task.text.trim().toLowerCase();
    const key = task.googleEventId
      ? `gid:${task.googleEventId}`
      : `local:${normalizedText}|${task.dueDate || ""}|${task.dueTime || ""}`;

    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, task);
      return;
    }

    const existingScore = scoreTask(existing);
    const currentScore = scoreTask(task);
    if (currentScore > existingScore) {
      bestByKey.set(key, {
        ...existing,
        ...task,
        id: existing.id || task.id
      });
      return;
    }

    if (currentScore === existingScore) {
      const existingCreatedAt = typeof existing.createdAt === "number" ? existing.createdAt : 0;
      const taskCreatedAt = typeof task.createdAt === "number" ? task.createdAt : 0;

      if (taskCreatedAt >= existingCreatedAt) {
        bestByKey.set(key, {
          ...existing,
          ...task,
          id: existing.id || task.id
        });
      }
      return;
    }

    bestByKey.set(key, {
      ...existing,
      ...task,
      id: existing.id || task.id
    });
  });

  return Array.from(bestByKey.values());
}

function removeBlockedTasks(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((task) => {
    const text = typeof task?.text === "string" ? task.text.trim().toLowerCase() : "";
    return !TASK_TEXT_BLOCKLIST.has(text);
  });
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return removeCompletedAppointments(removeBlockedTasks(dedupeTasks(parsed)));
  } catch {
    return [];
  }
}

function saveTasks() {
  if (isReadOnlyMode()) return;
  tasks = removeCompletedAppointments(removeBlockedTasks(dedupeTasks(tasks)));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));

  if (cloudEnabled && !isApplyingCloudSnapshot) {
    window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = window.setTimeout(() => {
      pushTasksToCloud();
    }, 250);
  }
}

function setCloudStatus(message, tone = "neutral") {
  if (!cloudStatus) return;
  cloudStatus.textContent = message;
  if (tone === "error") {
    cloudStatus.style.color = "var(--danger)";
    return;
  }
  if (tone === "success") {
    cloudStatus.style.color = "var(--accent)";
    return;
  }
  cloudStatus.style.color = "var(--text-sub)";
}

function setAuthStatus(message, tone = "neutral") {
  if (!authStatus) return;
  authStatus.textContent = message;
  if (tone === "error") {
    authStatus.style.color = "var(--danger)";
    return;
  }
  if (tone === "success") {
    authStatus.style.color = "var(--accent)";
    return;
  }
  authStatus.style.color = "var(--text-sub)";
}

function setLastSyncedTime(date = null) {
  if (!lastSyncStatus) return;
  if (!(date instanceof Date)) {
    lastSyncStatus.textContent = "Last synced: --";
    return;
  }

  lastSyncStatus.textContent = `Last synced: ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
}

function setPhoneAlertsButtonState(label, disabled = false) {
  if (!phoneAlertsBtn) return;
  phoneAlertsBtn.textContent = label;
  phoneAlertsBtn.disabled = disabled;
}

function isHostedOrigin() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function isFirebaseConfigured() {
  return Object.values(FIREBASE_CONFIG).every((value) => typeof value === "string" && value && !value.startsWith("PASTE_"));
}

function isFcmVapidConfigured() {
  return typeof FCM_VAPID_KEY === "string" && FCM_VAPID_KEY && !FCM_VAPID_KEY.startsWith("PASTE_");
}

function supportsWebPushMessaging() {
  return (
    typeof window !== "undefined"
    && "serviceWorker" in navigator
    && typeof firebase !== "undefined"
    && typeof firebase.messaging === "function"
  );
}

function isStandaloneAppMode() {
  const iosStandalone = typeof navigator !== "undefined" && navigator.standalone === true;
  const displayModeStandalone = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(display-mode: standalone)").matches;
  return iosStandalone || displayModeStandalone;
}

function getPhoneAlertsDiagnostic(options = {}) {
  const { requireSignIn = false } = options;
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (!isHostedOrigin()) {
    return { ok: false, message: "Phone alerts require a hosted URL (http/https), not file://." };
  }

  if (typeof Notification === "undefined") {
    return { ok: false, message: "This browser does not expose Notifications API for web push." };
  }

  if (!("serviceWorker" in navigator)) {
    return { ok: false, message: "Service workers are unavailable, so web push cannot be enabled." };
  }

  if (isIOS && !isStandaloneAppMode()) {
    return {
      ok: false,
      message: "On iPhone, open this app from a Home Screen icon (Safari > Share > Add to Home Screen), then try Phone alerts again."
    };
  }

  if (typeof firebase === "undefined") {
    return { ok: false, message: "Firebase SDK is not loaded yet. Reload the app and try again." };
  }

  if (typeof firebase.messaging !== "function") {
    return { ok: false, message: "Firebase Messaging is unavailable in this browser context." };
  }

  if (!isFcmVapidConfigured()) {
    return { ok: false, message: "FCM VAPID key is missing in app config." };
  }

  if (requireSignIn && !firebaseAuthRef?.currentUser) {
    return { ok: false, message: "Sign in first to enable phone alerts." };
  }

  if (Notification.permission === "denied") {
    return {
      ok: false,
      message: "Notifications are blocked for this app. Enable notifications in browser/iPhone settings and try again."
    };
  }

  return { ok: true, message: "" };
}

function getTasksSignature(items) {
  const normalized = items
    .map((task) => normalizeTask(task))
    .filter((task) => task)
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(normalized);
}

async function pushTasksToCloud() {
  if (isReadOnlyMode()) return;
  if (!cloudEnabled || !cloudDocRef) return;

  try {
    await cloudDocRef.set(
      {
        tasks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    setLastSyncedTime(new Date());
  } catch (error) {
    setCloudStatus(error instanceof Error ? `Cloud sync write failed: ${error.message}` : "Cloud sync write failed.", "error");
  }
}

function getUserCloudDocRef(userId) {
  if (!firebaseDbRef || !userId) return null;
  return firebaseDbRef
    .collection(FIRESTORE_USERS_COLLECTION)
    .doc(userId)
    .collection(FIRESTORE_TODO_COLLECTION)
    .doc(FIRESTORE_TODO_DOC_ID);
}

function getUserNotificationTokenDocRef(userId, token) {
  if (!firebaseDbRef || !userId || !token) return null;
  return firebaseDbRef
    .collection(FIRESTORE_USERS_COLLECTION)
    .doc(userId)
    .collection("notificationTokens")
    .doc(token);
}

function getDeviceTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

async function upsertUserTimeZone(user) {
  if (isReadOnlyMode()) return;
  if (!firebaseDbRef || !user?.uid) return;
  const timeZone = getDeviceTimeZone();
  try {
    await firebaseDbRef.collection(FIRESTORE_USERS_COLLECTION).doc(user.uid).set({
      timeZone,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    setCloudStatus(error instanceof Error ? `Could not save device timezone: ${error.message}` : "Could not save device timezone.", "error");
  }
}

async function registerWebPushTokenForUser(user) {
  if (isReadOnlyMode()) return false;
  if (!user?.uid || !firebaseMessagingRef) return false;
  const diagnostic = getPhoneAlertsDiagnostic({ requireSignIn: true });
  if (!diagnostic.ok) {
    setSyncStatus(diagnostic.message, "error");
    return false;
  }
  if (!isFcmVapidConfigured()) {
    setSyncStatus("Set FCM_VAPID_KEY in script.js to enable phone push alerts.", "error");
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    const token = await firebaseMessagingRef.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      setSyncStatus("Could not get push token. Allow notifications and try again.", "error");
      return false;
    }

    const tokenDocRef = getUserNotificationTokenDocRef(user.uid, token);
    if (tokenDocRef) {
      await tokenDocRef.set({
        token,
        platform: "web",
        userAgent: navigator.userAgent,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    currentNotificationToken = token;
    return true;
  } catch (error) {
    setSyncStatus(error instanceof Error ? `Phone alerts setup failed: ${error.message}` : "Phone alerts setup failed.", "error");
    return false;
  }
}

async function refreshCurrentDeviceTokenIfPossible(user) {
  if (!user?.uid) return false;
  if (!isHostedOrigin()) return false;
  if (!supportsWebPushMessaging()) return false;
  if (!isFcmVapidConfigured()) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  if (!firebaseMessagingRef) {
    try {
      firebaseMessagingRef = firebase.messaging(firebaseAppRef);
    } catch {
      return false;
    }
  }

  const registered = await registerWebPushTokenForUser(user);
  if (registered) {
    setPhoneAlertsButtonState("Phone alerts on", false);
  }
  return registered;
}

async function enablePhoneAlerts() {
  if (isReadOnlyMode()) {
    setSyncStatus("Read-only demo mode: phone alerts setup is disabled.", "error");
    return;
  }
  const diagnostic = getPhoneAlertsDiagnostic({ requireSignIn: true });
  if (!diagnostic.ok) {
    setSyncStatus(diagnostic.message, "error");
    return;
  }

  setPhoneAlertsButtonState("Enabling...", true);

  const permissionGranted = await ensureNotificationPermission();
  if (!permissionGranted) {
    setPhoneAlertsButtonState("Phone alerts", false);
    setSyncStatus("Notification permission was not granted.", "error");
    return;
  }

  const registered = await registerWebPushTokenForUser(firebaseAuthRef.currentUser);
  if (registered) {
    setPhoneAlertsButtonState("Phone alerts on", false);
    setSyncStatus("Phone alerts enabled on this device. Next step: send FCM messages from backend scheduler.", "success");
    return;
  }

  setPhoneAlertsButtonState("Phone alerts", false);
}

function setupFirebaseMessaging() {
  const diagnostic = getPhoneAlertsDiagnostic({ requireSignIn: false });
  if (!diagnostic.ok) {
    setPhoneAlertsButtonState("Phone alerts", false);
    return;
  }

  try {
    firebaseMessagingRef = firebase.messaging(firebaseAppRef);
  } catch {
    firebaseMessagingRef = null;
    setPhoneAlertsButtonState("Phone alerts", false);
    return;
  }

  if (firebaseMessagingRef && typeof firebaseMessagingRef.onMessage === "function") {
    firebaseMessagingRef.onMessage((payload) => {
      const title = payload?.notification?.title || "Appointment reminder";
      const body = payload?.notification?.body || "You have an upcoming appointment.";
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      }
      playReminderTone();
      setSyncStatus("Phone alert received.", "success");
    });
  }

  const signedIn = Boolean(firebaseAuthRef?.currentUser);
  setPhoneAlertsButtonState(signedIn ? "Phone alerts" : "Phone alerts", false);
}

function detachCloudListener() {
  if (typeof cloudUnsubscribe === "function") {
    cloudUnsubscribe();
  }
  cloudUnsubscribe = null;
  cloudDocRef = null;
  cloudEnabled = false;
}

function attachCloudListenerForUser(user) {
  if (!user?.uid) return;

  detachCloudListener();
  cloudDocRef = getUserCloudDocRef(user.uid);
  if (!cloudDocRef) {
    setCloudStatus("Cloud sync not ready.", "error");
    return;
  }

  cloudEnabled = true;
  setCloudStatus("Cloud sync connecting...");

  let firstSnapshot = true;

  cloudUnsubscribe = cloudDocRef.onSnapshot(
    async (snapshot) => {
      const rawIncoming = snapshot.exists && Array.isArray(snapshot.data().tasks)
        ? dedupeTasks(snapshot.data().tasks)
        : [];
      const incoming = removeCompletedAppointments(removeBlockedTasks(rawIncoming));
      const removedBlockedCount = rawIncoming.length - incoming.length;

      if (firstSnapshot) {
        firstSnapshot = false;

        if (incoming.length === 0 && tasks.length > 0) {
          await pushTasksToCloud();
          setCloudStatus("Cloud sync active (seeded from this device).", "success");
          setLastSyncedTime(new Date());
          return;
        }

        if (incoming.length > 0 && getTasksSignature(incoming) !== getTasksSignature(tasks)) {
          isApplyingCloudSnapshot = true;
          tasks = incoming;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
          render();
          isApplyingCloudSnapshot = false;
        }

        setCloudStatus("Cloud sync active across devices.", "success");
        setLastSyncedTime(new Date());
        if (removedBlockedCount > 0) {
          window.setTimeout(() => {
            pushTasksToCloud();
          }, 0);
        }
        return;
      }

      if (getTasksSignature(incoming) === getTasksSignature(tasks)) return;

      isApplyingCloudSnapshot = true;
      tasks = incoming;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      render();
      isApplyingCloudSnapshot = false;
      setCloudStatus("Tasks updated from cloud.", "success");
      setLastSyncedTime(new Date());
      if (removedBlockedCount > 0) {
        window.setTimeout(() => {
          pushTasksToCloud();
        }, 0);
      }
    },
    (error) => {
      setCloudStatus(error instanceof Error ? `Cloud sync listener failed: ${error.message}` : "Cloud sync listener failed.", "error");
    }
  );
}

function syncAuthButtonFromCurrentUser() {
  if (!authToggleBtn) return;
  const isSignedIn = Boolean(firebaseAuthRef?.currentUser);
  authToggleBtn.textContent = isSignedIn ? "Sign out" : "Sign in";
  authToggleBtn.setAttribute(
    "aria-label",
    isSignedIn ? "Sign out from cloud sync" : "Sign in to cloud sync"
  );
}

async function handleAuthToggle() {
  if (isReadOnlyMode()) {
    setAuthStatus("Read-only demo mode: sign-in is disabled.", "error");
    return;
  }
  if (!firebaseAuthRef || !authToggleBtn) return;

  if (!isHostedOrigin()) {
    setAuthStatus("Firebase sign-in requires a hosted URL (http/https), not file://.", "error");
    setCloudStatus("Cloud sync paused. Host the app URL and sign in again.", "error");
    return;
  }

  authToggleBtn.disabled = true;
  authToggleBtn.textContent = "Working...";

  try {
    if (firebaseAuthRef.currentUser) {
      await firebaseAuthRef.signOut();
      return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      await firebaseAuthRef.signInWithPopup(provider);
    } catch (popupError) {
      if (popupError?.code === "auth/unauthorized-domain") {
        throw new Error("This domain is not authorized in Firebase Auth. Add it in Firebase Console > Authentication > Settings > Authorized domains.");
      }
      await firebaseAuthRef.signInWithRedirect(provider);
    }
  } catch (error) {
    setAuthStatus(error instanceof Error ? `Sign-in failed: ${error.message}` : "Sign-in failed.", "error");
  } finally {
    authToggleBtn.disabled = false;
    syncAuthButtonFromCurrentUser();
  }
}

function setupFirebaseCloudSync() {
  if (isReadOnlyMode()) {
    setCloudStatus("Read-only demo mode: cloud sync is disabled.");
    setAuthStatus("Read-only demo mode: authentication is disabled.");
    return;
  }
  if (typeof firebase === "undefined" || !firebase?.apps) {
    setCloudStatus("Firebase SDK not loaded. Cloud sync disabled.", "error");
    return;
  }

  if (!isFirebaseConfigured()) {
    setCloudStatus("Add your Firebase config in script.js to enable shared cloud sync.");
    return;
  }

  try {
    firebaseAppRef = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDbRef = firebase.firestore(firebaseAppRef);
    firebaseAuthRef = firebase.auth(firebaseAppRef);
    setupFirebaseMessaging();

    if (!isHostedOrigin()) {
      setAuthStatus("Open this app from a hosted http/https URL to use Firebase sign-in.", "error");
      setCloudStatus("Cloud sync paused on file:// origin.", "error");
      setPhoneAlertsButtonState("Phone alerts (use http/https)", true);
      return;
    }

    firebaseAuthRef.getRedirectResult().catch((error) => {
      setAuthStatus(error instanceof Error ? `Sign-in redirect failed: ${error.message}` : "Sign-in redirect failed.", "error");
    });

    if (authToggleBtn) {
      authToggleBtn.addEventListener("click", () => {
        handleAuthToggle();
      });
    }

    syncAuthButtonFromCurrentUser();

    firebaseAuthRef.onAuthStateChanged((user) => {
      if (!authToggleBtn) return;

      if (!user) {
        detachCloudListener();
        authToggleBtn.textContent = "Sign in";
        authToggleBtn.setAttribute("aria-label", "Sign in to cloud sync");
        setAuthStatus("Signed out. Sign in to enable private cloud sync.");
        setCloudStatus("Cloud sync paused (not signed in).");
        setLastSyncedTime(null);
        currentNotificationToken = "";
        setPhoneAlertsButtonState("Phone alerts", false);
        return;
      }

      const who = user.email || "Google user";
      authToggleBtn.textContent = "Sign out";
      authToggleBtn.setAttribute("aria-label", "Sign out from cloud sync");
      setAuthStatus(`Signed in as ${who}.`, "success");
      attachCloudListenerForUser(user);
      upsertUserTimeZone(user);
      refreshCurrentDeviceTokenIfPossible(user);
      setPhoneAlertsButtonState(currentNotificationToken ? "Phone alerts on" : "Phone alerts", false);
    });
  } catch (error) {
    cloudEnabled = false;
    setCloudStatus(error instanceof Error ? `Cloud sync setup failed: ${error.message}` : "Cloud sync setup failed.", "error");
    setAuthStatus("Authentication setup failed.", "error");
  }
}

function loadTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

function loadView() {
  const stored = localStorage.getItem(VIEW_KEY);
  if (stored === "calendar" || stored === "list") return stored;
  return "list";
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark", isDark);
  themeToggleBtn.textContent = isDark ? "Light mode" : "Dark mode";
}

function applyView(view) {
  const isCalendar = view === "calendar";
  activeView = isCalendar ? "calendar" : "list";

  list.classList.toggle("is-hidden", isCalendar);
  controlsSection.classList.toggle("is-hidden", isCalendar);
  calendarSection.classList.toggle("is-hidden", !isCalendar);

  viewListBtn.classList.toggle("active", !isCalendar);
  viewCalendarBtn.classList.toggle("active", isCalendar);
  viewListBtn.setAttribute("aria-pressed", String(!isCalendar));
  viewCalendarBtn.setAttribute("aria-pressed", String(isCalendar));
}

function setSyncStatus(message, tone = "neutral") {
  if (!syncStatus) return;
  syncStatus.textContent = message;
  if (tone === "error") {
    syncStatus.style.color = "var(--danger)";
    return;
  }
  if (tone === "success") {
    syncStatus.style.color = "var(--accent)";
    return;
  }
  syncStatus.style.color = "var(--text-sub)";
}

function applyReadOnlyUiConstraints() {
  if (!isReadOnlyMode()) return;

  const readOnlyButtons = [
    authToggleBtn,
    phoneAlertsBtn,
    deleteCompletedNowBtn,
    syncGoogleCalendarBtn,
    importOnlyGoogleBtn,
    testPushNowBtn,
    openVsCodeFolderBtn,
    testGasConnectionBtn
  ];

  readOnlyButtons.forEach((button) => {
    if (!button) return;
    button.disabled = true;
    button.title = "Read-only demo mode";
  });

  if (runLocallyBtn) {
    runLocallyBtn.hidden = true;
  }

  setSyncStatus("Read-only demo mode: view only. Editing, sync, delete, and sign-in are disabled.");
}

function getAppointmentIconMeta(text) {
  const normalized = (text || "").toLowerCase();

  if (normalized.includes("dentist")) {
    return { src: "dentist-icon.svg", alt: "Dentist appointment", emoji: "🦷" };
  }

  if (normalized.includes("zumba") || normalized.includes("dance")) {
    return { src: "dance-icon.svg", alt: "Dance appointment", emoji: "💃" };
  }

  if (normalized.includes("sorensdale") || normalized.includes("sdp transition") || normalized.includes("school")) {
    return { src: "school-icon.svg", alt: "School appointment", emoji: "🏫" };
  }

  if (normalized.includes("quest") || normalized.includes("diagnostic") || normalized.includes("lab")) {
    return { src: "lab-icon.svg", alt: "Lab appointment", emoji: "🧪" };
  }

  if (normalized.includes("doctor") || normalized.includes("cardiologist")) {
    return { src: "doctor-icon.svg", alt: "Doctor appointment", emoji: "🩺" };
  }

  return null;
}

function normalizeGoogleTitle(title) {
  if (typeof title !== "string") return "Google Calendar event";
  return title.replace(/^✅\s*/u, "").replace(/^📌\s*/u, "").trim() || "Google Calendar event";
}

function mergeGoogleEventsIntoTasks(events) {
  if (!Array.isArray(events) || events.length === 0) return 0;

  let importedCount = 0;

  events.forEach((event) => {
    const googleEventId = typeof event.googleEventId === "string" ? event.googleEventId : "";
    const dueDate = isValidDueDate(event.dueDate) ? event.dueDate : "";
    const eventTimeRaw = event.dueTime || event.time || event.startTime || event.startDateTime || "";
    const normalizedEventTime = normalizeDueTime(eventTimeRaw);
    const text = normalizeGoogleTitle(event.text);
    if (!googleEventId || !dueDate || !text) return;

    const existingByEvent = tasks.findIndex((task) => task.googleEventId === googleEventId);
    if (existingByEvent >= 0) {
      const current = tasks[existingByEvent];
      tasks[existingByEvent] = {
        ...current,
        text,
        dueDate,
        dueTime: normalizedEventTime || current.dueTime || "",
        googleEventId
      };
      return;
    }

    const textDateKey = `${text.toLowerCase()}|${dueDate}`;
    const existingByTextDate = tasks.findIndex((task) => `${task.text.toLowerCase()}|${task.dueDate}` === textDateKey);
    if (existingByTextDate >= 0) {
      tasks[existingByTextDate] = {
        ...tasks[existingByTextDate],
        dueTime: normalizedEventTime || tasks[existingByTextDate].dueTime || "",
        googleEventId
      };
      return;
    }

    tasks.unshift({
      id: `gcal-${googleEventId}`,
      text,
      createdAt: Date.now(),
      dueDate,
      dueTime: normalizedEventTime,
      googleEventId
    });
    importedCount += 1;
  });

  return importedCount;
}

function removeMissingGoogleEvents(importedEvents, importWindowDays) {
  if (!Array.isArray(importedEvents)) return 0;

  const importedIds = new Set(
    importedEvents
      .map((event) => (typeof event.googleEventId === "string" ? event.googleEventId : ""))
      .filter((id) => id)
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + importWindowDays);

  const beforeCount = tasks.length;

  tasks = tasks.filter((task) => {
    if (!task.googleEventId) return true;
    if (!isValidDueDate(task.dueDate)) return true;

    const due = new Date(`${task.dueDate}T00:00:00`);
    const inImportRange = due.getTime() >= today.getTime() && due.getTime() <= end.getTime();
    if (!inImportRange) return true;

    return importedIds.has(task.googleEventId);
  });

  return beforeCount - tasks.length;
}

function formatDueTime(value) {
  const normalized = normalizeDueTime(value);
  if (!normalized) return "";
  const [hourRaw, minute] = normalized.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) return "";

  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${period}`;
}

function callGasWebAppJsonp(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName = `gasCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Apps Script request timed out. Check deployment access and URL."));
    }, timeoutMs);

    window[callbackName] = (data) => {
      window.clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("Failed to reach Google Apps Script. Verify Web App deployment and permissions."));
    };

    const query = new URLSearchParams({
      ...params,
      secret: GAS_SHARED_SECRET,
      callback: callbackName
    });

    script.src = `${GAS_WEB_APP_URL}?${query.toString()}`;
    document.body.appendChild(script);
  });
}

async function testGoogleAppsScriptConnection() {
  if (!testGasConnectionBtn) return;

  if (!GAS_WEB_APP_URL) {
    setSyncStatus("Add your Google Apps Script Web App URL first.", "error");
    return;
  }

  testGasConnectionBtn.disabled = true;
  const previousLabel = testGasConnectionBtn.textContent;
  testGasConnectionBtn.textContent = "Testing...";
  setSyncStatus("Testing Google Apps Script connection...");

  try {
    const result = await callGasWebAppJsonp({
      action: "import",
      days: "1"
    }, 10000);

    if (!result?.ok) {
      throw new Error(result?.error || "Connection test failed.");
    }

    setSyncStatus("Connection successful. Google Apps Script is reachable.", "success");
  } catch (error) {
    setSyncStatus(error instanceof Error ? error.message : "Connection test failed.", "error");
  } finally {
    testGasConnectionBtn.disabled = false;
    testGasConnectionBtn.textContent = previousLabel;
  }
}

async function sendTestPushNow() {
  if (isReadOnlyMode()) {
    setSyncStatus("Read-only demo mode: test push is disabled.", "error");
    return;
  }
  if (!testPushNowBtn) return;

  if (!firebaseAuthRef?.currentUser?.uid) {
    setSyncStatus("Sign in first, then use Test push.", "error");
    return;
  }

  if (!currentNotificationToken) {
    await refreshCurrentDeviceTokenIfPossible(firebaseAuthRef.currentUser);
  }

  const userId = firebaseAuthRef.currentUser.uid;
  const params = new URLSearchParams({
    userId,
    title: "Test appointment reminder",
    body: "Immediate test push from your app"
  });

  if (currentNotificationToken) {
    params.set("targetToken", currentNotificationToken);
  }
  params.set("clientUserAgent", navigator.userAgent || "");

  if (TEST_PUSH_SECRET) {
    params.set("secret", TEST_PUSH_SECRET);
  }

  const url = `${TEST_PUSH_FUNCTION_URL}?${params.toString()}`;
  const previousLabel = testPushNowBtn.textContent;
  testPushNowBtn.disabled = true;
  testPushNowBtn.textContent = "Sending...";
  setSyncStatus("Sending test push...", "neutral");

  try {
    const response = await fetch(url, { method: "GET", mode: "cors" });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const message = payload?.error || `HTTP ${response.status}`;
      throw new Error(message);
    }

    setSyncStatus(
      `Test push sent. Success: ${payload.successCount}, failures: ${payload.failureCount}, tokens: ${payload.tokenCount}.`,
      "success"
    );
  } catch (error) {
    setSyncStatus(error instanceof Error ? `Test push failed: ${error.message}` : "Test push failed.", "error");
  } finally {
    testPushNowBtn.disabled = false;
    testPushNowBtn.textContent = previousLabel;
  }
}

async function syncTasksToGoogleCalendar() {
  if (isReadOnlyMode()) {
    setSyncStatus("Read-only demo mode: Google Calendar sync is disabled.", "error");
    return;
  }
  if (!syncGoogleCalendarBtn) return;

  if (!GAS_WEB_APP_URL) {
    setSyncStatus("Add your Google Apps Script Web App URL in script.js first.", "error");
    return;
  }

  const dueTasks = tasks.filter((task) => isValidDueDate(task.dueDate));
  const tasksToPush = dueTasks.filter((task) => !task.googleEventId);

  syncGoogleCalendarBtn.disabled = true;
  const previousLabel = syncGoogleCalendarBtn.textContent;
  syncGoogleCalendarBtn.textContent = "Syncing...";
  setSyncStatus("Syncing with Google Calendar (push + import)...");

  try {
    let pushWarning = "";

    if (tasksToPush.length > 0) {
      const payload = {
        secret: GAS_SHARED_SECRET,
        tasks: tasksToPush.map((task) => ({
          id: task.id,
          text: task.text,
          dueDate: task.dueDate,
          dueTime: task.dueTime || "",
          completed: false,
          googleEventId: task.googleEventId || ""
        }))
      };

      try {
        const data = await callGasWebAppJsonp({
          action: "sync",
          payload: JSON.stringify(payload)
        });

        if (!data?.ok) {
          throw new Error(data?.error || "Google Calendar push sync failed.");
        }

        if (Array.isArray(data.events)) {
          const eventMap = new Map(data.events.map((item) => [item.id, item.googleEventId]));
          tasks = tasks.map((task) => {
            const eventId = eventMap.get(task.id);
            if (!eventId) return task;
            return { ...task, googleEventId: eventId };
          });
        }

        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          pushWarning = `${data.warnings.length} item(s) skipped during push`;
        }
      } catch (pushError) {
        const message = pushError instanceof Error ? pushError.message : "Push sync failed.";
        if (message.toLowerCase().includes("action not allowed")) {
          pushWarning = "Some Google events are read-only and were skipped";
        } else {
          pushWarning = "Push step failed; import still completed";
        }
      }
    }

    const importWindowDays = 120;
    const { importedCount, removedCount } = await importFromGoogleCalendar(importWindowDays);

    const pushedLabel = `${tasksToPush.length} pushed`;
    const importedLabel = `${importedCount} imported`;
    const removedLabel = `${removedCount} removed`;
    if (pushWarning) {
      setSyncStatus(`Sync complete: ${pushedLabel}, ${importedLabel}, ${removedLabel}. Note: ${pushWarning}.`, "success");
    } else {
      setSyncStatus(`Sync complete: ${pushedLabel}, ${importedLabel}, ${removedLabel}.`, "success");
    }
  } catch (error) {
    setSyncStatus(error instanceof Error ? error.message : "Sync failed.", "error");
  } finally {
    syncGoogleCalendarBtn.disabled = false;
    syncGoogleCalendarBtn.textContent = previousLabel;
  }
}

async function importFromGoogleCalendar(importWindowDays = 120) {
  const importData = await callGasWebAppJsonp({
    action: "import",
    days: String(importWindowDays)
  });

  if (!importData?.ok) {
    throw new Error(importData?.error || "Google Calendar import failed.");
  }

  const importedCount = mergeGoogleEventsIntoTasks(importData.events || []);
  const removedCount = removeMissingGoogleEvents(importData.events || [], importWindowDays);
  saveTasks();
  render();

  return { importedCount, removedCount };
}

async function importOnlyFromGoogleCalendar() {
  if (isReadOnlyMode()) {
    setSyncStatus("Read-only demo mode: Google Calendar import is disabled.", "error");
    return;
  }
  if (!importOnlyGoogleBtn) return;

  if (!GAS_WEB_APP_URL) {
    setSyncStatus("Add your Google Apps Script Web App URL in script.js first.", "error");
    return;
  }

  importOnlyGoogleBtn.disabled = true;
  const previousLabel = importOnlyGoogleBtn.textContent;
  importOnlyGoogleBtn.textContent = "Importing...";
  setSyncStatus("Importing from Google Calendar (no push)...");

  try {
    const importWindowDays = 120;
    const { importedCount, removedCount } = await importFromGoogleCalendar(importWindowDays);
    setSyncStatus(`Import complete: ${importedCount} imported, ${removedCount} removed. No push performed.`, "success");
  } catch (error) {
    setSyncStatus(error instanceof Error ? error.message : "Import failed.", "error");
  } finally {
    importOnlyGoogleBtn.disabled = false;
    importOnlyGoogleBtn.textContent = previousLabel;
  }
}

function formatDueDate(value) {
  if (!isValidDueDate(value)) return "No due date";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function isOverdue(task) {
  if (!isValidDueDate(task.dueDate)) return false;
  const dueTime = new Date(`${task.dueDate}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueTime < today.getTime();
}

function isUpcomingWithinDays(task, days) {
  if (!isValidDueDate(task.dueDate)) return false;
  const due = new Date(`${task.dueDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setDate(end.getDate() + days);

  return due.getTime() >= today.getTime() && due.getTime() <= end.getTime();
}

function formatMonthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function getDueCountByDate() {
  const map = new Map();
  tasks.forEach((task) => {
    if (!isValidDueDate(task.dueDate)) return;
    map.set(task.dueDate, (map.get(task.dueDate) || 0) + 1);
  });
  return map;
}

function renderCalendarAgenda() {
  if (!isValidDueDate(selectedCalendarDate)) {
    calendarSelectedLabel.textContent = "Select a date";
    calendarSelectedList.innerHTML = "";
    return;
  }

  const dueToday = tasks
    .filter((task) => task.dueDate === selectedCalendarDate)
    .sort((a, b) => {
      const aHasTime = isValidDueTime(a.dueTime);
      const bHasTime = isValidDueTime(b.dueTime);
      if (aHasTime && bHasTime) {
        const byTime = a.dueTime.localeCompare(b.dueTime);
        if (byTime !== 0) return byTime;
      }
      if (aHasTime) return -1;
      if (bHasTime) return 1;
      return b.createdAt - a.createdAt;
    });

  calendarSelectedLabel.textContent = `Due on ${formatDueDate(selectedCalendarDate)}`;
  calendarSelectedList.innerHTML = "";

  if (dueToday.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No appointments due.";
    calendarSelectedList.appendChild(li);
    return;
  }

  dueToday.forEach((task) => {
    const li = document.createElement("li");
    const timeText = formatDueTime(task.dueTime);
    li.textContent = timeText ? `${timeText} — ${task.text}` : task.text;
    calendarSelectedList.appendChild(li);
  });
}

function renderCalendar() {
  const year = currentCalendarMonth.getFullYear();
  const month = currentCalendarMonth.getMonth();
  const firstDayWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toLocalDateKey(new Date());
  const dueCount = getDueCountByDate();

  calendarMonthLabel.textContent = formatMonthLabel(currentCalendarMonth);
  calendarGrid.innerHTML = "";

  for (let i = 0; i < firstDayWeekday; i += 1) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "calendar-day empty";
    empty.tabIndex = -1;
    calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.textContent = String(day);
    cell.setAttribute("aria-label", `View tasks for ${formatDueDate(dateKey)}`);

    if (dateKey === todayKey) cell.classList.add("today");
    if (dateKey === selectedCalendarDate) cell.classList.add("selected");
    if (dueCount.get(dateKey)) {
      cell.classList.add("has-due");
      cell.title = `${dueCount.get(dateKey)} task(s) due`;
    }

    cell.addEventListener("click", () => {
      selectedCalendarDate = dateKey;
      renderCalendar();
      renderCalendarAgenda();
    });

    calendarGrid.appendChild(cell);
  }

  renderCalendarAgenda();
}

function applyFilters(items) {
  let result = items;

  if (activeRange === "7") result = result.filter((task) => isUpcomingWithinDays(task, 7));
  if (activeRange === "14") result = result.filter((task) => isUpcomingWithinDays(task, 14));
  if (activeRange === "30") result = result.filter((task) => isUpcomingWithinDays(task, 30));

  return result;
}

function applySort(items) {
  const sorted = [...items];

  sorted.sort((a, b) => {
    const aHasDue = isValidDueDate(a.dueDate);
    const bHasDue = isValidDueDate(b.dueDate);
    if (aHasDue && bHasDue) {
      const byDueDate = new Date(`${a.dueDate}T00:00:00`) - new Date(`${b.dueDate}T00:00:00`);
      if (byDueDate !== 0) return byDueDate;

      const aHasTime = isValidDueTime(a.dueTime);
      const bHasTime = isValidDueTime(b.dueTime);
      if (aHasTime && bHasTime) {
        const byTime = a.dueTime.localeCompare(b.dueTime);
        if (byTime !== 0) return byTime;
      }
      if (aHasTime) return -1;
      if (bHasTime) return 1;

      return b.createdAt - a.createdAt;
    }
    if (aHasDue) return -1;
    if (bHasDue) return 1;
    return b.createdAt - a.createdAt;
  });

  return sorted;
}

function getVisibleTasks() {
  return applySort(applyFilters(tasks));
}

function updateItemsLeft() {
  const count = tasks.length;
  itemsLeft.textContent = `${count} appointment${count === 1 ? "" : "s"}`;
}

function render() {
  if (!isReadOnlyMode()) {
    const beforeCount = tasks.length;
    tasks = removeCompletedAppointments(tasks);
    if (tasks.length !== beforeCount) {
      saveTasks();
    }
  }

  list.innerHTML = "";
  const visibleTasks = getVisibleTasks();

  visibleTasks.forEach((task) => {
    const fragment = itemTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".todo-item");
    const appointmentIcon = fragment.querySelector(".appointment-icon");
    const appointmentEmoji = fragment.querySelector(".appointment-emoji");
    const text = fragment.querySelector(".task-text");
    const dueDate = fragment.querySelector(".due-date");
    const appointmentTime = fragment.querySelector(".appointment-time");
    const deleteBtn = fragment.querySelector(".delete-btn");

    item.dataset.id = task.id;
    text.textContent = task.text;
    const iconMeta = getAppointmentIconMeta(task.text);
    if (appointmentIcon) {
      if (iconMeta) {
        appointmentIcon.src = iconMeta.src;
        appointmentIcon.alt = iconMeta.alt;
        appointmentIcon.hidden = false;
        if (appointmentEmoji) {
          appointmentEmoji.textContent = iconMeta.emoji || "📌";
          appointmentEmoji.hidden = true;
        }

        appointmentIcon.onerror = () => {
          appointmentIcon.hidden = true;
          if (appointmentEmoji) {
            appointmentEmoji.textContent = iconMeta.emoji || "📌";
            appointmentEmoji.hidden = false;
          }
        };
      } else {
        appointmentIcon.hidden = true;
        appointmentIcon.removeAttribute("src");
        appointmentIcon.alt = "";
        if (appointmentEmoji) {
          appointmentEmoji.hidden = true;
          appointmentEmoji.textContent = "";
        }
      }
    }
    dueDate.textContent = formatDueDate(task.dueDate);
    if (appointmentTime) {
      const timeText = formatDueTime(task.dueTime);
      appointmentTime.textContent = timeText || "All day";
    }

    if (deleteBtn) {
      if (isReadOnlyMode()) {
        deleteBtn.disabled = true;
        deleteBtn.title = "Read-only demo mode";
      } else {
        deleteBtn.addEventListener("click", () => {
          tasks = tasks.filter((itemTask) => itemTask.id !== task.id);
          saveTasks();
          render();
          setSyncStatus(`Deleted: ${task.text}.`, "success");
        });
      }
    }

    if (isOverdue(task)) item.classList.add("overdue");

    list.appendChild(fragment);
  });

  updateItemsLeft();
  renderCalendar();
}

function startCompletedAppointmentCleanupTicker() {
  if (isReadOnlyMode()) return;
  window.setInterval(() => {
    const beforeCount = tasks.length;
    tasks = removeCompletedAppointments(tasks);
    if (tasks.length === beforeCount) return;
    saveTasks();
    render();
  }, 60 * 1000);
}

function handleDeleteCompletedNow() {
  if (isReadOnlyMode()) {
    setSyncStatus("Read-only demo mode: delete actions are disabled.", "error");
    return;
  }
  const beforeCount = tasks.length;
  tasks = removeCompletedAppointmentsImmediately(tasks);
  const removedCount = beforeCount - tasks.length;
  if (removedCount > 0) {
    saveTasks();
    render();
    setSyncStatus(`Deleted ${removedCount} completed appointment${removedCount === 1 ? "" : "s"}.`, "success");
    return;
  }
  setSyncStatus("No completed appointments to delete.", "neutral");
}

sortSelect.addEventListener("change", () => {
  sortMode = "due-asc";
  sortSelect.value = "due-asc";
  render();
});

themeToggleBtn.addEventListener("click", () => {
  const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, nextTheme);
  applyTheme(nextTheme);
});

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeRange = button.dataset.range || "all";

    rangeButtons.forEach((candidate) => {
      const isActive = candidate === button;
      candidate.classList.toggle("active", isActive);
      candidate.setAttribute("aria-selected", String(isActive));
    });

    render();
  });
});

calendarPrevBtn.addEventListener("click", () => {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1);
  renderCalendar();
});

calendarNextBtn.addEventListener("click", () => {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

viewListBtn.addEventListener("click", () => {
  localStorage.setItem(VIEW_KEY, "list");
  applyView("list");
});

viewCalendarBtn.addEventListener("click", () => {
  localStorage.setItem(VIEW_KEY, "calendar");
  applyView("calendar");
});

if (syncGoogleCalendarBtn) {
  syncGoogleCalendarBtn.addEventListener("click", () => {
    syncTasksToGoogleCalendar();
  });
}

if (importOnlyGoogleBtn) {
  importOnlyGoogleBtn.addEventListener("click", () => {
    importOnlyFromGoogleCalendar();
  });
}

if (testPushNowBtn) {
  testPushNowBtn.addEventListener("click", () => {
    sendTestPushNow();
  });
}

if (refreshAppBtn) {
  refreshAppBtn.addEventListener("click", () => {
    window.location.reload();
  });
}

if (deleteCompletedNowBtn) {
  deleteCompletedNowBtn.addEventListener("click", () => {
    handleDeleteCompletedNow();
  });
}

window.handleDeleteCompletedNow = handleDeleteCompletedNow;

if (runLocallyBtn) {
  runLocallyBtn.addEventListener("click", () => {
    const localUrl = "http://localhost:5500";
    if (window.location.protocol === "http:" && window.location.hostname === "localhost") {
      setSyncStatus("Already running locally.", "success");
      return;
    }

    window.open(localUrl, "_blank", "noopener,noreferrer");
    setSyncStatus("Opened local URL. If it fails, start a local server (for example Live Server).", "neutral");
  });
}

if (openVsCodeFolderBtn) {
  openVsCodeFolderBtn.addEventListener("click", () => {
    const vscodeUrl = `vscode://file/${encodeURI(PROJECT_FOLDER_PATH)}`;
    window.location.href = vscodeUrl;
    setSyncStatus("Attempted to open the project folder in VS Code.", "neutral");
  });
}

if (testGasConnectionBtn) {
  testGasConnectionBtn.addEventListener("click", () => {
    testGoogleAppsScriptConnection();
  });
}

if (phoneAlertsBtn) {
  phoneAlertsBtn.addEventListener("click", () => {
    enablePhoneAlerts();
  });
}

applyTheme(loadTheme());
applyView(loadView());
applyReadOnlyUiConstraints();
sortSelect.value = "due-asc";
sortSelect.disabled = true;
sortSelect.title = "Appointments are always sorted by nearest due date";
saveTasks();
render();
startCompletedAppointmentCleanupTicker();
setupFirebaseCloudSync();
