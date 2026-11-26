import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { INSPECTION_METHODS, type InspectionMethod } from '../../common/domain/enums.js';
import { LATER_INSPECTION_PHOTO_SLOTS, type LaterInspectionPhotoSlot } from '../domain/later-inspection.js';

export class StartClaimInspectionDto {
  @IsIn(INSPECTION_METHODS)
  method!: InspectionMethod;
}

class LaterInspectionPhotoDto {
  @IsIn(LATER_INSPECTION_PHOTO_SLOTS)
  slot!: LaterInspectionPhotoSlot;

  @IsUUID()
  documentId!: string;
}

export class AddLaterInspectionEvidenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LATER_INSPECTION_PHOTO_SLOTS.length)
  @ArrayUnique((photo: LaterInspectionPhotoDto) => photo?.slot)
  @ValidateNested({ each: true })
  @Type(() => LaterInspectionPhotoDto)
  photos!: LaterInspectionPhotoDto[];
}

export class PublishInspectionReportDto {
  @IsUUID()
  documentId!: string;
}
