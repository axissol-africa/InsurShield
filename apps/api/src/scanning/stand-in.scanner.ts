import { Injectable } from '@nestjs/common';
import type { MalwareScanner, ScanVerdict } from './scanner.port.js';

/**
 * The industry's agreed harmless test file. Every real scanner reports it as a
 * detection, so a journey written against this stand-in keeps working against a
 * live scanner.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** The signature a scanner reports for the test file. */
export const EICAR_SIGNATURE = 'EICAR-Test-File';

/**
 * Development and test stand-in for a malware scanner. It detects the EICAR
 * test string so the refusal path is exercised without a scanner service, and
 * calls everything else clean.
 *
 * It is never a safe production choice, which is why it registers as a stand-in
 * and the provider gate refuses a production start while it is selected.
 */
@Injectable()
export class StandInScanner implements MalwareScanner {
  readonly name = 'stand-in';

  // Not `async`: there is nothing to await here, while the port stays async
  // because a live scanner is a network call.
  scan(bytes: Buffer): Promise<ScanVerdict> {
    return Promise.resolve(
      bytes.includes(EICAR) ? { result: 'infected', signature: EICAR_SIGNATURE } : { result: 'clean' },
    );
  }
}
