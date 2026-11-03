// Helpers for the public /join registration form.

const DEVICE_KEY = "salesmesh.device_id";

/**
 * A random ID for this browser, kept in localStorage. The backend counts how
 * many different emails register from one device (device_distinct_emails_8w).
 * If storage is blocked (private mode), the value is sent as missing.
 */
export function getDeviceId(): string | null {
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/**
 * A random UUID for one filled-in form. The backend treats repeats of it as one
 * registration. getRandomValues also works on plain HTTP, unlike randomUUID.
 */
export function newSubmissionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** Minutes between two timestamps in milliseconds, at least 0. */
export function minutesBetween(start: number, end: number): number {
  return Math.max(0, (end - start) / 60000);
}

// East African countries and neighbours first, then a short "Other" list.
export const COUNTRY_GROUPS = [
  {
    label: "East Africa",
    codes: ["KE", "UG", "TZ", "RW", "BI", "SS", "ET", "SO", "CD"],
  },
  { label: "Other", codes: ["US", "GB", "IN", "CN", "AE"] },
];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  return regionNames.of(code) ?? code;
}

export const PRIVACY_CONTACT_EMAIL: string =
  import.meta.env.VITE_PRIVACY_CONTACT_EMAIL || "privacy@example.com";
