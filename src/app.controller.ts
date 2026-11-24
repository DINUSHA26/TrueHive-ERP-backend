import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "./common/decorators/roles.decorator";

@ApiTags("Root")
@Controller()
export class AppController {
  @Public()
  @Get()
  @ApiOperation({ summary: "Root health probe for Lightsail & Load Balancers" })
  getRoot() {
    return {
      status: "healthy",
      service: "TrueHive ERP & CRM Enterprise API",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    };
  }
}
