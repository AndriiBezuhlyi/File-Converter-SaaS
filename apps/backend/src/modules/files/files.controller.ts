import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ConversionBoundaryGuard,
  type ConversionRequest,
} from '../conversions/conversion-boundary.js';
import { AuthError } from '../auth/auth-error.js';
import { FilesService } from './files.service.js';

@Controller('files')
@UseGuards(ConversionBoundaryGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}
  private user(request: ConversionRequest) {
    if (request.conversionPrincipal.kind === 'guest')
      throw new AuthError(401, 'AUTH_REQUIRED', 'Please sign in.');
    return request.conversionPrincipal.userId;
  }
  @Get()
  list(@Req() request: ConversionRequest, @Query() query: Record<string, unknown>) {
    return this.files.list(this.user(request), query);
  }
  @Get(':id')
  details(@Req() request: ConversionRequest, @Param('id') id: string) {
    return this.files.details(this.user(request), id);
  }
  @Get(':id/download')
  async download(
    @Req() request: ConversionRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.files.download(this.user(request), id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body, {
      type: file.mime,
      length: file.size,
      disposition: `attachment; filename="conversion.${file.name.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
    });
  }
  @Delete(':id')
  @HttpCode(204)
  async delete(@Req() request: ConversionRequest, @Param('id') id: string) {
    await this.files.delete(this.user(request), id);
  }
}
