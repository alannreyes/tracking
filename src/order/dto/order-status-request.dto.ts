import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class OrderStatusRequestDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value : String(value ?? '')))
  orderNumber!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return null;
    }
    return typeof value === 'string' ? value : String(value);
  })
  itemNumber: string | null = null;
}
