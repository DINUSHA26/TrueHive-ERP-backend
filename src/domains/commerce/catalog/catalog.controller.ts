import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { CatalogService } from "./catalog.service";
import { Public } from "@/common/decorators/roles.decorator";

@ApiTags("Commerce")
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ----------------- PRODUCTS -----------------
  @Public()
  @Get("products")
  @ApiOperation({ summary: "List all inventory products & live stock levels" })
  async getProducts(
    @Query("search") search?: string,
    @Query("categoryId") categoryId?: string,
    @Query("status") status?: string
  ) {
    return this.catalogService.getProducts({ search, categoryId, status });
  }

  @Public()
  @Post("products")
  @ApiOperation({ summary: "Create a new product with barcode, SKU, images, and variants" })
  async createProduct(@Body() body: any) {
    return this.catalogService.createProduct(body);
  }

  @Public()
  @Patch("products")
  @ApiOperation({ summary: "Update product details or stock adjustment" })
  async updateProduct(@Body() body: any) {
    return this.catalogService.updateProduct(body.id, body);
  }

  @Public()
  @Put("products")
  @ApiOperation({ summary: "Put update product" })
  async putProduct(@Body() body: any) {
    return this.catalogService.updateProduct(body.id, body);
  }

  @Public()
  @Put("products/:id")
  @ApiOperation({ summary: "Put update product by ID parameter" })
  async putProductById(@Param("id") id: string, @Body() body: any) {
    return this.catalogService.updateProduct(id, body);
  }

  @Public()
  @Patch("products/:id")
  @ApiOperation({ summary: "Patch update product by ID parameter" })
  async patchProductById(@Param("id") id: string, @Body() body: any) {
    return this.catalogService.updateProduct(id, body);
  }

  @Public()
  @Delete("products")
  @ApiOperation({ summary: "Deactivate or delete a product by id query" })
  async deleteProduct(@Query("id") id: string) {
    return this.catalogService.deleteProduct(id);
  }

  @Public()
  @Delete("products/:id")
  @ApiOperation({ summary: "Deactivate or delete a product by id param" })
  async deleteProductParam(@Param("id") id: string) {
    return this.catalogService.deleteProduct(id);
  }

  @Public()
  @Get("products/barcode/:code")
  @ApiOperation({ summary: "Lookup product by SKU or Barcode" })
  async getByBarcode(@Param("code") code: string) {
    const product = await this.catalogService.getProductByBarcode(code);
    return { success: Boolean(product), product };
  }

  // ----------------- CATEGORIES -----------------
  @Public()
  @Get("categories")
  @ApiOperation({ summary: "List product categories with hierarchy and product count" })
  async getCategories(
    @Query("search") search?: string,
    @Query("status") status?: string
  ) {
    return this.catalogService.getCategories({ search, status });
  }

  @Public()
  @Post("categories")
  @ApiOperation({ summary: "Create a product category with slug and image" })
  async createCategory(@Body() body: any) {
    return this.catalogService.createCategory(body);
  }

  @Public()
  @Patch("categories")
  @ApiOperation({ summary: "Update an existing category" })
  async updateCategory(@Body() body: any) {
    return this.catalogService.updateCategory(body.id, body);
  }

  @Public()
  @Put("categories")
  @ApiOperation({ summary: "Put update category" })
  async putCategory(@Body() body: any) {
    return this.catalogService.updateCategory(body.id, body);
  }

  @Public()
  @Put("categories/:id")
  @ApiOperation({ summary: "Put update category by id param" })
  async putCategoryById(@Param("id") id: string, @Body() body: any) {
    return this.catalogService.updateCategory(id, body);
  }

  @Public()
  @Patch("categories/:id")
  @ApiOperation({ summary: "Patch update category by id param" })
  async patchCategoryById(@Param("id") id: string, @Body() body: any) {
    return this.catalogService.updateCategory(id, body);
  }

  @Public()
  @Delete("categories")
  @ApiOperation({ summary: "Delete category by id query" })
  async deleteCategory(@Query("id") id: string) {
    return this.catalogService.deleteCategory(id);
  }

  @Public()
  @Delete("categories/:id")
  @ApiOperation({ summary: "Delete category by id param" })
  async deleteCategoryParam(@Param("id") id: string) {
    return this.catalogService.deleteCategory(id);
  }
}
