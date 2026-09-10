const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = "SHA-256";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordBytes = new TextEncoder().encode(password);

  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: DIGEST },
    key,
    KEY_LENGTH * 8,
  );

  const hash = new Uint8Array(derivedBits);
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...hash].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const passwordBytes = new TextEncoder().encode(password);

  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: DIGEST },
    key,
    KEY_LENGTH * 8,
  );

  const newHash = [...new Uint8Array(derivedBits)].map(b => b.toString(16).padStart(2, "0")).join("");
  return newHash === hashHex;
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
