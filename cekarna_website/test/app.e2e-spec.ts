import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { readEnvironment } from '../src/config/environment';

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
    }).compile();
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
});
