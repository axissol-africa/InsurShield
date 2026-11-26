import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClaimEvidenceDto, ClaimUpdateDto } from './claims.dto.js';

const revision = 'CLM-1:acknowledged';
const documentId = '9c4b2673-9ca8-42c0-a18c-d2850c14b139';

describe('claim command revisions', () => {
  it.each([undefined, null, '', 42])(
    'rejects revision %s on both commands',
    async (expectedRevision) => {
      const update = plainToInstance(ClaimUpdateDto, {
        action: 'START_REVIEW',
        message: 'Review',
        expectedRevision,
      });
      const evidence = plainToInstance(ClaimEvidenceDto, {
        documentIds: [documentId],
        expectedRevision,
      });
      for (const command of [update, evidence]) {
        expect(
          (await validate(command)).map((error) => error.property),
        ).toContain('expectedRevision');
      }
    },
  );

  it('accepts synthetic and persisted revisions', async () => {
    for (const expectedRevision of [revision, documentId]) {
      expect(
        await validate(
          plainToInstance(ClaimUpdateDto, {
            action: 'START_REVIEW',
            message: 'Review',
            expectedRevision,
          }),
        ),
      ).toEqual([]);
      expect(
        await validate(
          plainToInstance(ClaimEvidenceDto, {
            documentIds: [documentId],
            expectedRevision,
          }),
        ),
      ).toEqual([]);
    }
  });
});
