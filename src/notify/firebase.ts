import type { Env } from "../types";

export interface FcmNotificationPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64urlEncode(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken(
  clientEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      })
    )
  );

  const keyBuffer = pemToArrayBuffer(privateKeyPem);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const dataToSign = new TextEncoder().encode(`${header}.${payload}`);
  const sigBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, dataToSign);
  const signature = base64urlEncode(new Uint8Array(sigBuffer));

  const jwt = `${header}.${payload}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google OAuth Token Error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

export async function sendFcmNotification(
  env: Env,
  payload: FcmNotificationPayload
): Promise<void> {
  const { token, title, body, data } = payload;

  // Extract raw FCM token if token string is a Web Push JSON object with endpoint
  let fcmToken = token;
  try {
    const parsed = JSON.parse(token);
    if (parsed.token) {
      fcmToken = parsed.token;
    } else if (parsed.endpoint && typeof parsed.endpoint === "string") {
      const parts = parsed.endpoint.split("/");
      fcmToken = parts[parts.length - 1];
    }
  } catch {
    // Raw token string
  }

  // 1. Try FCM HTTP v1 API using Service Account JSON string in env.FIREBASE_SERVICE_ACCOUNT
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    let serviceAccount: { project_id: string; client_email: string; private_key: string };
    try {
      serviceAccount = typeof env.FIREBASE_SERVICE_ACCOUNT === "string"
        ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)
        : env.FIREBASE_SERVICE_ACCOUNT;
    } catch {
      throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON configuration");
    }

    const accessToken = await getGoogleAccessToken(
      serviceAccount.client_email,
      serviceAccount.private_key
    );

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    const res = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          data: data || {},
          webpush: {
            headers: {
              Urgency: "high",
            },
            notification: {
              title,
              body,
              icon: "/favicon.ico",
              requireInteraction: true,
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FCM v1 API Error ${res.status}: ${err}`);
    }
    return;
  }

  // 2. Fallback to FCM Legacy Server Key if env.FIREBASE_SERVER_KEY is configured
  if (env.FIREBASE_SERVER_KEY) {
    const res = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Authorization": `key=${env.FIREBASE_SERVER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: { title, body },
        data: data || {},
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FCM Legacy API Error ${res.status}: ${err}`);
    }
    return;
  }

  console.warn("Firebase credentials (FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVER_KEY) not configured.");
}
