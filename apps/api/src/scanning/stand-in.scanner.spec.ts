import { describe, expect, it } from 'vitest';
import { EICAR_SIGNATURE, StandInScanner } from './stand-in.scanner.js';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('StandInScanner', () => {
  const scanner = new StandInScanner();

  it('reports the EICAR test file as a detection, as a real scanner does', async () => {
    await expect(scanner.scan(Buffer.from(EICAR))).resolves.toEqual({
      result: 'infected',
      signature: EICAR_SIGNATURE,
    });
  });

  it('finds the test string anywhere in the file, not only at the start', async () => {
    const buried = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(EICAR), Buffer.from('\n%%EOF')]);

    await expect(scanner.scan(buried)).resolves.toMatchObject({ result: 'infected' });
  });

  it('calls an ordinary file clean', async () => {
    await expect(scanner.scan(Buffer.from('%PDF-1.7 a genuine document'))).resolves.toEqual({ result: 'clean' });
  });

  it('calls an empty file clean rather than guessing', async () => {
    await expect(scanner.scan(Buffer.alloc(0))).resolves.toEqual({ result: 'clean' });
  });
});
