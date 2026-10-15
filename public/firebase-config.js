// ─────────────────────────────────────────────────────────────
//  1) Paste your Firebase web config here
//     (Firebase console → Project settings → General → Your apps → Web app → Config)
// ─────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDU-pBjFiTCXI_pPjmYUX7xOKjveuQWuh8",
  authDomain: "token1-986c8.firebaseapp.com",
  projectId: "token1-986c8",
  storageBucket: "token1-986c8.firebasestorage.app",
  messagingSenderId: "315804916047",
  appId: "1:315804916047:web:14625c242f61299eea0d3a",
};

// ─────────────────────────────────────────────────────────────
//  2) Admin Google email(s). Must ALSO be listed in firestore.rules.
// ─────────────────────────────────────────────────────────────
export const ADMIN_EMAILS = ["iirufan@gmail.com"];

// Awards created by the "Create default awards" button on the admin page.
// IDs must not contain underscores.
export const DEFAULT_CATEGORIES = [
  { id: "football-male",   title: "Best Football Player", subtitle: "Male",   emoji: "⚽", order: 1 },
  { id: "football-female", title: "Best Football Player", subtitle: "Female", emoji: "⚽", order: 2 },
  { id: "dress-male",      title: "Best Dressed",         subtitle: "Male",   emoji: "👔", order: 3 },
  { id: "dress-female",    title: "Best Dressed",         subtitle: "Female", emoji: "👗", order: 4 },
  { id: "cute-girl",       title: "Office Cutest Girl",   subtitle: "",       emoji: "🌸", order: 5 },
  { id: "handsome-guy",    title: "Most Handsome Guy",    subtitle: "",       emoji: "😎", order: 6 },
];

// ─────────────────────────────────────────────────────────────
//  Nothing below needs changing
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export const CONFIG_MISSING = Object.values(firebaseConfig).some((v) => String(v).includes("PASTE_"));

export const app = initializeApp(firebaseConfig);
// Long-polling auto-detect helps on office Wi-Fi / proxies that block streaming connections.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
export const auth = getAuth(app);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Turns a Firebase error into a plain-language fix shown on the page.
export function explainError(err) {
  const code = err?.code || "";
  const host = location.hostname;
  const fixes = {
    "config-missing":
      "The Firebase config is not filled in. Open <b>public/firebase-config.js</b> and paste your project's config values.",
    "auth/configuration-not-found":
      "Authentication is not set up. Firebase console → <b>Build → Authentication → Get started</b>, then enable <b>Anonymous</b> and <b>Google</b> under Sign-in method.",
    "auth/admin-restricted-operation":
      "Anonymous sign-in is off. Firebase console → <b>Authentication → Sign-in method → Anonymous → Enable</b>.",
    "auth/operation-not-allowed":
      "This sign-in method is off. Firebase console → <b>Authentication → Sign-in method</b> → enable <b>Anonymous</b> and <b>Google</b>.",
    "auth/unauthorized-domain":
      `This website address is not approved. Firebase console → <b>Authentication → Settings → Authorized domains → Add domain</b> and add exactly: <b>${esc(host)}</b>`,
    "auth/popup-blocked":
      "The browser blocked the sign-in popup. Allow popups for this site and try again.",
    "auth/popup-closed-by-user": "The sign-in window was closed. Try again.",
    "auth/invalid-api-key":
      "The apiKey in <b>firebase-config.js</b> is wrong. Copy the config again from Project settings.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "The apiKey in <b>firebase-config.js</b> is wrong. Copy the config again from Project settings.",
    "auth/network-request-failed":
      "No internet connection, or the network is blocking Firebase. Check Wi-Fi and try again.",
    "permission-denied":
      "The database rules are blocking access. Firebase console → <b>Firestore Database → Rules</b>: paste the contents of <b>firestore.rules</b> (with your admin email) and click <b>Publish</b>.",
    "not-found":
      "The Firestore database does not exist yet. Firebase console → <b>Build → Firestore Database → Create database</b>.",
    "unavailable":
      "Cannot reach the database. Make sure the Firestore database is created (Build → Firestore Database) and the internet is working.",
    "timeout":
      "Still cannot reach the database after 15 seconds. Most likely the <b>Firestore database has not been created</b> (Build → Firestore Database → Create database), or <b>projectId</b> in firebase-config.js is wrong.",
  };
  const fix = fixes[code] || esc(err?.message || String(err));
  return `
    <div class="errbox">
      <div class="errtitle">⚠️ Setup problem</div>
      <div>${fix}</div>
      ${code ? `<div class="errcode">${esc(code)}</div>` : ""}
      <button class="btn small secondary" onclick="location.reload()" style="margin-top:12px">Try again</button>
    </div>`;
}

// Rejects with code "timeout" if a promise takes too long.
export function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej({ code: "timeout" }), ms)),
  ]);
}
