import { Injectable, Logger } from "@nestjs/common";
import { v2 as cloudinary } from "cloudinary";

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dylen3nql",
      api_key: process.env.CLOUDINARY_API_KEY || "995685688433653",
      api_secret: process.env.CLOUDINARY_API_SECRET || "nCczfh0HZPrS93k4kzJFJ7ATe8U",
      secure: true,
    });
  }

  /**
   * Upload Multer File, Buffer, or Base64 string to Cloudinary with WebP optimization
   */
  async uploadFile(
    file: Express.Multer.File | string | Buffer,
    folder = "products"
  ): Promise<{ url: string; publicId: string; width?: number; height?: number; format?: string; bytes?: number }> {
    try {
      let filePayload: string;
      if (typeof file === "string") {
        filePayload = file.startsWith("data:") ? file : `data:image/png;base64,${file}`;
      } else if (Buffer.isBuffer(file)) {
        filePayload = `data:image/png;base64,${file.toString("base64")}`;
      } else if (file && (file as any).buffer) {
        const mime = (file as any).mimetype || "image/png";
        filePayload = `data:${mime};base64,${(file as any).buffer.toString("base64")}`;
      } else {
        throw new Error("Invalid file format provided for upload");
      }

      const result = await cloudinary.uploader.upload(filePayload, {
        folder: `truehive-crm/${folder}`,
        resource_type: "auto",
        format: "webp",
        transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      });

      return {
        url: result.secure_url || result.url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
      };
    } catch (err: any) {
      this.logger.error(`Cloudinary upload failed: ${err.message}`, err.stack);
      throw err;
    }
  }
}
