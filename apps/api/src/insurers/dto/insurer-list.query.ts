import { IsIn, IsOptional } from 'class-validator';

/**
 * The normal staff list omits deleted insurers. Only a super admin may ask
 * explicitly for the recoverable deleted records.
 */
export class InsurerListQuery {
  @IsOptional()
  @IsIn(['deleted'])
  status?: 'deleted';
}
