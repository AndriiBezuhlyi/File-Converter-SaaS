import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import type { Server } from 'node:http';
import { ConversionsController, ConversionAdmissionGuard } from './conversions.controller.js';
import { ConversionBoundaryGuard } from './conversion-boundary.js';
import { ConversionsService } from './conversions.service.js';
import { validateUpload, type StagedUpload } from './upload-validation.js';

describe('Unicode filenames across the real multipart boundary', () => {
  let app: INestApplication<Server>;
  let bytes: Buffer;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConversionsController],
      providers: [
        {
          provide: ConversionsService,
          useValue: {
            create: (_principal: unknown, file: StagedUpload, body: unknown) =>
              validateUpload(file, body),
          },
        },
      ],
    })
      .overrideGuard(ConversionBoundaryGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ConversionAdmissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#208c5a' } })
      .jpeg()
      .toBuffer();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([
    'Зображення червень.jpg',
    'café déjà vu.jpg',
    'two spaces image.jpg',
    'Фото été 東京 12.jpg',
  ])('preserves UTF-8 multipart filename %s', async (name) => {
    const response = await request(app.getHttpServer())
      .post('/conversions')
      .field('targetFormat', 'png')
      .attach('file', bytes, { filename: name });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ name, format: 'jpg', target: 'png' });
  });
});
