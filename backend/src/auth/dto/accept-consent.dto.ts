import { IsString, MinLength } from 'class-validator';

export class AcceptConsentDto {
  /** Version of the privacy notice and terms the customer was shown. */
  @IsString()
  @MinLength(1, { message: 'The notice version is required.' })
  noticeVersion!: string;
}
