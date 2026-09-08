import {
  Body,
  Controller,
  INestApplication,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { readEnvironment } from '../src/config/environment';
import { sampleCvPdf } from '../src/cv-import/pdf-text.spec';
import type { CvExtraction } from '../src/cv-import/cv-import.types';
import { IdentityService } from '../src/cv-import/identity.service';
import { ReadinessService } from '../src/readiness.service';

class ProbeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

// Test-only route: no probe endpoint is registered in the production module.
@Controller('_test')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
}

describe('API HTTP configuration', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(IdentityService)
      .useValue({
        userId: (authorization?: string) => {
          if (!authorization?.startsWith('Bearer candidate-'))
            throw new UnauthorizedException();
          return Promise.resolve(authorization.slice('Bearer '.length));
        },
      })
      .overrideProvider(ReadinessService)
      .useValue({
        check: () =>
          Promise.resolve({
            status: 'ready',
            dependencies: {
              identity: { status: 'up', latency_ms: 1 },
              offers: { status: 'up', latency_ms: 1 },
              hermes: {
                status: 'up',
                latency_ms: 1,
                model: 'hermes3:3b',
              },
            },
          }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(
      app,
      readEnvironment({ CORS_ORIGINS: 'http://localhost:3001' }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('identifies the API', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ name: 'Cekarna API', status: 'initialization' });
  });

  it('exposes uncached liveness with security headers', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect({ status: 'ok' });
  });

  it('exposes uncached dependency readiness', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({
        status: 'ready',
        dependencies: {
          identity: { status: 'up', latency_ms: 1 },
          offers: { status: 'up', latency_ms: 1 },
          hermes: {
            status: 'up',
            latency_ms: 1,
            model: 'hermes3:3b',
          },
        },
      });
  });

  it('allows the configured frontend origin', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:3001')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3001');
  });

  it('does not authorize a foreign origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200);
    expect(response.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('accepts a valid DTO', () => {
    return request(app.getHttpServer())
      .post('/_test')
      .send({ name: 'Cekarna' })
      .expect(201)
      .expect({ name: 'Cekarna' });
  });

  it.each([{ name: 42 }, {}, { name: '' }, { name: 'Cekarna', admin: true }])(
    'rejects invalid or unexpected fields: %j',
    (body) => {
      return request(app.getHttpServer()).post('/_test').send(body).expect(400);
    },
  );

  it('returns 404 for an unknown endpoint', () => {
    return request(app.getHttpServer()).get('/missing').expect(404);
  });

  describe('import de CV', () => {
    it('refuse un import sans session', () => {
      return request(app.getHttpServer())
        .post('/v1/cv-import/extraction')
        .attach('file', sampleCvPdf(), {
          filename: 'cv.pdf',
          contentType: 'application/pdf',
        })
        .expect(401);
    });
    it('refuse un fichier qui n’est pas un PDF', () => {
      return request(app.getHttpServer())
        .post('/v1/cv-import/extraction')
        .set('Authorization', 'Bearer candidate-test')
        .attach('file', Buffer.from('texte brut'), {
          filename: 'cv.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
    });

    it('propose un profil justifié puis valide la correction manuelle', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/cv-import/extraction')
        .set('Authorization', 'Bearer candidate-a')
        .attach('file', sampleCvPdf(), {
          filename: 'cv.pdf',
          contentType: 'application/pdf',
        })
        .expect(200)
        .expect('Cache-Control', 'no-store');
      const extraction = response.body as CvExtraction;

      const city = extraction.fields.find((field) => field.field === 'city');
      expect(city?.candidates[0]).toMatchObject({
        value: 'Paris',
        excerpts: [expect.objectContaining({ page: 1, text: '75011 Paris' })],
      });

      await request(app.getHttpServer())
        .post('/v1/cv-import/profile')
        .set('Authorization', 'Bearer candidate-a')
        .send({
          documentId: extraction.documentId,
          fields: {
            city: { value: 'Paris', source: 'extracted' },
            about: { value: 'Disponible en octobre.', source: 'manual' },
          },
        })
        .expect(200)
        .expect({
          profile: {
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            title: '',
            city: 'Paris',
            contract: '',
            skills: '',
            about: 'Disponible en octobre.',
          },
          excerpts: { city: city?.candidates[0].excerpts, about: [] },
          experiences: [],
          education: [],
          provenance: {
            firstName: 'empty',
            lastName: 'empty',
            email: 'empty',
            phone: 'empty',
            title: 'empty',
            city: 'extracted',
            contract: 'empty',
            skills: 'empty',
            about: 'manual',
          },
        });
    });

    it('refuse une valeur présentée comme extraite mais absente du CV', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/cv-import/extraction')
        .set('Authorization', 'Bearer candidate-a')
        .attach('file', sampleCvPdf(), {
          filename: 'cv.pdf',
          contentType: 'application/pdf',
        })
        .expect(200);
      const extraction = response.body as CvExtraction;

      await request(app.getHttpServer())
        .post('/v1/cv-import/profile')
        .set('Authorization', 'Bearer candidate-a')
        .send({
          documentId: extraction.documentId,
          fields: { city: { value: 'Bordeaux', source: 'extracted' } },
        })
        .expect(400);
    });

    it('refuse à un autre compte de confirmer une analyse', async () => {
      const extraction = await request(app.getHttpServer())
        .post('/v1/cv-import/extraction')
        .set('Authorization', 'Bearer candidate-a')
        .attach('file', sampleCvPdf(), {
          filename: 'cv.pdf',
          contentType: 'application/pdf',
        })
        .expect(200);
      const documentId = (extraction.body as CvExtraction).documentId;
      await request(app.getHttpServer())
        .post('/v1/cv-import/profile')
        .set('Authorization', 'Bearer candidate-b')
        .send({ documentId, fields: {} })
        .expect(400);
    });
  });

  describe('recommandations d’offres', () => {
    it('refuse une analyse sans session', () =>
      request(app.getHttpServer())
        .post('/v1/local-ai/recommend-offers')
        .send({ profile: { skills: 'React' } })
        .expect(401));

    it('refuse les champs inattendus avant tout appel à Hermes', () =>
      request(app.getHttpServer())
        .post('/v1/local-ai/recommend-offers')
        .set('Authorization', 'Bearer candidate-a')
        .send({ profile: { skills: 'React' }, email: 'secret@example.test' })
        .expect(400));
  });
});
