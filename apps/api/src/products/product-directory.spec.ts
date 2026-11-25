import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductsService } from './products.service.js';
import { ProductsRepository } from './products.repository.js';
import { InsurersService } from '../insurers/insurers.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { PiaService } from '../pia/pia.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ProductDirectoryQueryDto } from './dto/product.dto.js';

const versionId = '71cfcfaf-c5bf-4941-8b45-11ff9c350778';

it('validates a version-specific directory lookup', async () => {
  expect(await validate(plainToInstance(ProductDirectoryQueryDto, { productVersionId: versionId, limit: '1' }))).toEqual([]);
  const errors = await validate(plainToInstance(ProductDirectoryQueryDto, { productVersionId: 'invalid' }));
  expect(errors.map((error) => error.property)).toContain('productVersionId');
});

it('resolves a selected version through the existing server availability query with its cover type', async () => {
  const directory = vi.fn().mockResolvedValue([]);
  const module = await Test.createTestingModule({
    providers: [
      ProductsService,
      { provide: ProductsRepository, useValue: { directory, comparisonItemsForVersions: vi.fn().mockResolvedValue([]), requirementsForVersions: vi.fn().mockResolvedValue([]) } },
      ...[InsurersService, AuditService, PiaService, SettingsService].map((provide) => ({ provide, useValue: {} })),
    ],
  }).compile();
  try {
    const service = module.get(ProductsService);
    expect(await service.directory({ coverType: 'COMPREHENSIVE', productVersionId: versionId, limit: 1 })).toEqual([]);
    expect(directory).toHaveBeenCalledWith(expect.any(Date), 'COMPREHENSIVE', 1, undefined, versionId);
  } finally {
    await module.close();
  }
}, 30_000);
