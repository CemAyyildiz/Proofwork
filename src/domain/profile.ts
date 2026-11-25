/**
 * Pure rules shared by the profile service, the profile page and its form.
 * No I/O.
 */

/** ISO 3166-1 alpha-2, every officially assigned code. The form names them with `Intl.DisplayNames`. */
export const COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA " +
  "RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const COUNTRY_SET = new Set(COUNTRY_CODES);

export function isCountryCode(v: string): boolean {
  return COUNTRY_SET.has(v);
}

/** A Telegram username, trimmed: an optional `@`, then 5–32 characters that start with a letter, end with a letter or digit, and hold letters, digits and underscores. */
export const TELEGRAM_SOURCE = "@?[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]";
export const TELEGRAM_PATTERN = new RegExp(`^${TELEGRAM_SOURCE}$`);

export const PROFILE_LIMITS = { displayName: 40, bio: 160, city: 60 } as const;

/**
 * Where the profile prompt sends the visitor back to: a path on this site, or
 * `/`. Refuses protocol-relative (`//host`) and backslash spellings, which
 * browsers read as another host, and anything with control characters.
 */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return "/";
  // Dot segments can normalize into `//host` (`/.//evil.com`): judge the path the browser will actually use.
  let url: URL;
  try {
    url = new URL(raw, "http://x");
  } catch {
    return "/";
  }
  if (url.origin !== "http://x" || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}

/** The public profile page of a wallet. */
export function profilePath(pubkey: string): string {
  return `/u/${pubkey}`;
}

/** The prompt, sent from wherever the visitor signed in. */
export function promptPath(current: string): string {
  return `/profile?next=${encodeURIComponent(current)}`;
}

/** Where a fresh sign-in goes: the prompt, carrying the full current location, or nowhere (null) when no prompt is due or it is already shown. */
export function promptTarget(needsProfile: boolean, pathname: string, search: string, hash: string): string | null {
  if (!needsProfile || pathname === "/profile") return null;
  return promptPath(pathname + search + hash);
}
