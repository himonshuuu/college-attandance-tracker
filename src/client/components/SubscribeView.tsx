import React, { useEffect, useState } from "react";

interface SubscribeFetchData {
  hasBrowser?: boolean;
  hasEmail?: boolean;
  email?: string;
  vapidKey?: string;
  error?: string;
  message?: string;
}

declare global {
  interface Window {
    firebase?: any;
  }
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAem3j-vD6nYTAoqvG1p2IYYCFQ7FL1V8Y",
  authDomain: "college-attandance-tracker-202.firebaseapp.com",
  projectId: "college-attandance-tracker-202",
  storageBucket: "college-attandance-tracker-202.firebasestorage.app",
  messagingSenderId: "1057513234016",
  appId: "1:1057513234016:web:38c03953ff34e3561eed05",
  measurementId: "G-SB0VZ5XQ7Y",
};

export const SubscribeView: React.FC = () => {
  const [hasFirebase, setHasFirebase] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [vapidKey, setVapidKey] = useState("BH2Mc0SDTxo1LZnxF2FQL-p2TlBRX1nfG0HNOSG3H0Yx8qBb8ZwD40suAFcBCg_8ZO4dMzQjUcOmTft_oCXg3wA");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/subscribe")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch subscriptions");
        return res.json();
      })
      .then((d: unknown) => {
        const data = d as SubscribeFetchData;
        setHasFirebase(!!data.hasBrowser);
        setHasEmail(!!data.hasEmail);
        if (data.vapidKey) setVapidKey(data.vapidKey);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));

    if (typeof window !== "undefined" && window.firebase && window.firebase.messaging) {
      try {
        if (!window.firebase.apps.length) {
          window.firebase.initializeApp(FIREBASE_CONFIG);
        }
        const messaging = window.firebase.messaging();
        messaging.onMessage((payload: { notification?: { title?: string; body?: string }; data?: { title?: string; body?: string } }) => {
          console.log("[SubscribeView] Foreground message received:", payload);
          const title = payload.notification?.title || payload.data?.title || "Attendance Notification";
          const body = payload.notification?.body || payload.data?.body || "Your attendance status was updated.";
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, {
              body,
              icon: "/favicon.ico",
            });
          }
        });
      } catch (err) {
        console.warn("Foreground messaging setup error:", err);
      }
    }
  }, []);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const methods: string[] = [];
    if (hasFirebase) methods.push("browser");
    if (hasEmail) methods.push("email");

    let pushSubscription: string | unknown = null;

    if (hasFirebase) {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setError("This browser does not support push notifications.");
        setSaving(false);
        return;
      }

      try {
        let perm = Notification.permission;
        if (perm === "default") {
          perm = await Notification.requestPermission();
        }
        if (perm !== "granted") {
          setError("Notification permission was denied. Please allow notifications in browser settings.");
          setSaving(false);
          return;
        }

        // Register service worker if not already registered
        let reg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
        if (!reg) {
          reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        }
        await navigator.serviceWorker.ready;

        // Obtain FCM Token using Firebase JS SDK if available
        if (window.firebase && window.firebase.messaging) {
          if (!window.firebase.apps.length) {
            window.firebase.initializeApp(FIREBASE_CONFIG);
          }
          const messaging = window.firebase.messaging();
          const fcmToken = await messaging.getToken({
            serviceWorkerRegistration: reg,
            vapidKey: vapidKey,
          });
          if (fcmToken) {
            pushSubscription = fcmToken;
          }
        }

        // Fallback to Web Push subscribe if FCM token was not generated
        if (!pushSubscription && "PushManager" in window) {
          const applicationServerKey = base64UrlToUint8Array(vapidKey);
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: applicationServerKey as unknown as BufferSource,
            });
          }
          pushSubscription = sub.toJSON();
        }
      } catch (err: unknown) {
        console.warn("Failed to generate FCM / push subscription:", err);
        setError("Failed to initialize push subscription. Check browser permissions.");
        setSaving(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ methods, pushSubscription }),
      });
      const data = (await res.json()) as SubscribeFetchData;
      if (!res.ok || data.error) {
        setError(data.error || "Failed to save options.");
      } else {
        setMessage(data.message || "Saved!");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-slate-400 text-sm">Loading subscriptions...</div>;
  }

  return (
    <div className="bg-white rounded-2xl p-5 sm:p-6">
      <form onSubmit={handleSave}>
        <label className="block text-xs font-semibold text-slate-600 mb-2">
          How do you want to be notified?
        </label>

        <div className="flex flex-col gap-2.5 mb-2">
          {/* Browser Notification */}
          <div
            onClick={() => setHasFirebase(!hasFirebase)}
            className={`method-card ${hasFirebase ? "active" : ""}`}
          >
            <input type="checkbox" checked={hasFirebase} readOnly className="hidden" />
            <div className="dot"></div>
            <div>
              <div className="text-sm font-medium">Browser Notification</div>
              <div className="text-xs text-slate-400">Push notifications in your browser</div>
            </div>
          </div>

          {/* Email Notification */}
          <div
            onClick={() => setHasEmail(!hasEmail)}
            className={`method-card ${hasEmail ? "active" : ""}`}
          >
            <input type="checkbox" checked={hasEmail} readOnly className="hidden" />
            <div className="dot"></div>
            <div>
              <div className="text-sm font-medium">Email</div>
              <div className="text-xs text-slate-400">Receive alerts in your inbox</div>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          All attendance updates are also posted in the Discord channel.
        </p>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-xl border-none bg-blue-600 text-white text-sm font-semibold cursor-pointer mt-5 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      {message && <div className="msg msg-success show mt-3.5 p-3 rounded-xl text-sm">{message}</div>}
      {error && <div className="msg msg-error show mt-3.5 p-3 rounded-xl text-sm">{error}</div>}
    </div>
  );
};
