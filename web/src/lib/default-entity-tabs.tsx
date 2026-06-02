/**
 * default-entity-tabs — documents the built-in tab IDs reserved by ItemDetail.
 *
 * External code using EntityPageRegistry must not re-use these IDs. PR-DP07.
 */

/** Tab IDs already rendered by ItemDetail — do not register these via EntityPageRegistry. */
export const BUILTIN_TAB_IDS = [
  'genel',
  'alanlar',
  'iliskiler',
  'baglanti',
  'yasam',
  'gecmis',
  'saglik',
  'ai-oneriler',
] as const;

export type BuiltinTabId = (typeof BUILTIN_TAB_IDS)[number];
