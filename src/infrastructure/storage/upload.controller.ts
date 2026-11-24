import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags, ApiOperation, ApiConsumes } from "@nestjs/swagger";
import { StorageService } from "./storage.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Storage")
@Controller("upload")
export class UploadController {
  constructor(private readonly storageService: StorageService) {}

  @Public()
  @Post()
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload file or image (Multipart or Base64 JSON) to Cloudinary" })
  async upload(
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: { file?: string; folder?: string }
  ) {
    const folder = body?.folder || "products";

    if (file) {
      const res = await this.storageService.uploadFile(file, folder);
      return {
        success: true,
        data: res,
        url: res.url,
      };
    }

    if (body?.file) {
      const res = await this.storageService.uploadFile(body.file, folder);
      return {
        success: true,
        data: res,
        url: res.url,
      };
    }

    throw new BadRequestException("ගොනුවක් සපයා නොමැත (No file provided)");
  }
}
