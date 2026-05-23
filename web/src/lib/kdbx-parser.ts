/**
 * KeePass .kdbx file parser — browser-side (kdbxweb library).
 *
 * The .kdbx file is encrypted with a master password (and optionally a key file).
 * This module decrypts it entirely in the browser — plaintext never leaves the client.
 * Parsed entries are returned as `ParsedImportEntry` objects ready for the import wizard.
 */

import { Kdbx, KdbxCredentials, ProtectedValue } from 'kdbxweb';

export interface ParsedImportEntry {
  /** Suggested item name (from KeePass Title field). */
  title: string;
  /** KeePass group path, e.g. "Root/Work/Databases". */
  groupPath: string;
  /** Well-known fields parsed out. */
  username?: string;
  password?: string;  // plaintext — will be E2E encrypted by the import wizard
  url?: string;
  notes?: string;
  /** Any extra string fields not in the known set. */
  extra: Record<string, string>;
}

export interface KdbxParseResult {
  entries: ParsedImportEntry[];
  dbName: string;
}

/**
 * Parse a KeePass 4.x (.kdbx) file.
 *
 * @param fileBuffer - ArrayBuffer of the .kdbx file.
 * @param password - KeePass master password (plaintext string).
 * @throws KdbxError if the password is wrong or the file is corrupted.
 */
export async function parseKdbx(
  fileBuffer: ArrayBuffer,
  password: string,
): Promise<KdbxParseResult> {
  const credentials = new KdbxCredentials(
    ProtectedValue.fromString(password),
  );

  const db = await Kdbx.load(fileBuffer, credentials);
  const entries: ParsedImportEntry[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walkGroup(group: any, path: string) {
    // Enumerate sub-groups recursively.
    for (const child of (group as any).groups ?? []) {
      walkGroup(child, path ? `${path}/${child.name}` : child.name);
    }
    // Enumerate entries in this group.
    for (const entry of (group as any).entries ?? []) {
      const fields: Map<string, string | InstanceType<typeof ProtectedValue>> = entry.fields;

      function getField(key: string): string {
        const v = fields.get(key);
        if (!v) return '';
        if (typeof v === 'string') return v;
        return (v as ProtectedValue).getText() ?? '';
      }

      const known = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
      const extra: Record<string, string> = {};
      for (const [k, v] of fields) {
        if (!known.has(k)) {
          extra[k] = typeof v === 'string' ? v : ((v as ProtectedValue).getText() ?? '');
        }
      }

      entries.push({
        title: getField('Title') || 'Untitled',
        groupPath: path || 'Root',
        username: getField('UserName') || undefined,
        password: getField('Password') || undefined,
        url: getField('URL') || undefined,
        notes: getField('Notes') || undefined,
        extra,
      });
    }
  }

  const root = db.getDefaultGroup();
  walkGroup(root, '');

  return {
    entries,
    dbName: (db.meta as any).name ?? 'KeePass Database',
  };
}
