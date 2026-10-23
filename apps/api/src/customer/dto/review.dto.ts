import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ReviewPolicyDto {
  /** Whole stars. The scale the page shows is the scale that is stored. */
  @IsInt({ message: 'Choose a rating from 1 to 5 stars.' })
  @Min(1, { message: 'Choose a rating from 1 to 5 stars.' })
  @Max(5, { message: 'Choose a rating from 1 to 5 stars.' })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Please keep your comment under 500 characters.' })
  comment?: string;
}
