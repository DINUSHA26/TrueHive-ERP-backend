import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({ example: "admin@truehive.lk" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "Admin@2026#" })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;
}
