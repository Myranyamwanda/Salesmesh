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
