/**
 * What the upload use case needs from a malware scanner, and nothing more: the
 * bytes go in, a verdict comes out. No file name, no document kind and no
 * principal reach an outside scanner.
 */
export type ScanVerdict =
  | { result: 'clean' }
  /** `signature` is the scanner's own name for what it found, for the audit trail. */
  | { result: 'infected'; signature: string }
  /** The scanner could not be reached or could not decide; the upload fails closed. */
  | { result: 'unavailable'; reason: string };

export interface MalwareScanner {
  /** The adapter's name, stored on the document as scan provenance. */
  readonly name: string;
  scan(bytes: Buffer): Promise<ScanVerdict>;
}

export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');
