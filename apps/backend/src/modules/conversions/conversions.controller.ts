import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'node:fs/promises';
import { ConversionBoundaryGuard, type ConversionRequest } from './conversion-boundary.js';
import { ConversionsService } from './conversions.service.js';
import {
  CONVERSION_DIRECTIONS,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_IMAGE_PIXELS,
  MAX_UPLOAD_BYTES,
} from './conversion-policy.js';
import type { StagedUpload } from './upload-validation.js';
import { UPLOAD_STAGING_DIRECTORY } from './upload-staging.js';
import { UploadBudgetInterceptor } from './upload-budget.interceptor.js';
import { downloadDisposition } from '../../common/download-disposition.js';

@Injectable()
export class ConversionAdmissionGuard implements CanActivate {
  constructor(private readonly conversions: ConversionsService) {}
  async canActivate(context: ExecutionContext) {
    await this.conversions.preflight(
      context.switchToHttp().getRequest<ConversionRequest>().conversionPrincipal,
    );
    return true;
  }
}

@Controller('conversions')
@UseGuards(ConversionBoundaryGuard)
export class ConversionsController {
  constructor(private readonly conversions: ConversionsService) {}
  @Post()
  @HttpCode(202)
  @UseGuards(ConversionAdmissionGuard)
  @UseInterceptors(
    UploadBudgetInterceptor,
    FileInterceptor('file', {
      // Browsers send non-extended multipart filenames as UTF-8.
      defParamCharset: 'utf8',
      dest: UPLOAD_STAGING_DIRECTORY,
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1,
        fields: 1,
        fieldSize: 16,
        parts: 2,
        fieldNameSize: 32,
        fieldNestingDepth: 0,
        fieldArrayIndexLimit: 0,
      },
    }),
  )
  async create(
    @Req() request: ConversionRequest,
    @UploadedFile() file: StagedUpload | undefined,
    @Body() body: unknown,
  ) {
    try {
      return await this.conversions.create(request.conversionPrincipal, file, body);
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
    }
  }
  @Get(':id')
  status(@Req() request: ConversionRequest, @Param('id') id: string) {
    return this.conversions.status(request.conversionPrincipal, id, request.retainedGuest);
  }
  @Get(':id/download')
  async download(
    @Req() request: ConversionRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.conversions.download(
      request.conversionPrincipal,
      id,
      request.retainedGuest,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body, {
      type: file.mime,
      length: file.size,
      disposition: downloadDisposition(file.name),
    });
  }
}

@Controller('capabilities')
export class ConversionCapabilitiesController {
  @Get()
  @Header('Cache-Control', 'no-store')
  read() {
    return {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxImagePixels: MAX_IMAGE_PIXELS,
      maxArchiveBytes: MAX_ARCHIVE_BYTES,
      maxArchiveEntries: MAX_ARCHIVE_ENTRIES,
      pollIntervalMs: 1_500,
      directions: CONVERSION_DIRECTIONS,
    };
  }
}
