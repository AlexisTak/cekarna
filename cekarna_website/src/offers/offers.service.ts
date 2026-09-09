import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../config/environment';
import type { OffersQuery } from './offers.controller';
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);
  constructor(@Inject(ENVIRONMENT) private readonly config: Environment) {}
  list(query: OffersQuery) {
    const params = new URLSearchParams();
    for (const key of [
      'q',
      'location',
      'contract',
      'cursor',
      'limit',
      'duplicates',
    ] as const) {
      const value = query[key];
      if (value) params.set(key, value);
    }
    return this.call(`/v1/offers${params.size ? `?${params}` : ''}`);
  }
  get(id: string) {
    return this.call(`/v1/offers/${encodeURIComponent(id)}`);
  }
  shortlist(body: object) {
    return this.call('/v1/recommendations/shortlist', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }
  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.config.offersInternalToken)
      throw new ServiceUnavailableException(
        'Le service d’offres n’est pas configuré.',
      );
    let response: Response;
    try {
      response = await fetch(`${this.config.offersBaseUrl}${path}`, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: `Bearer ${this.config.offersInternalToken}`,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      this.logger.error('service d’offres injoignable');
      throw new ServiceUnavailableException(
        'Le service d’offres est injoignable.',
      );
    }
    if (!response.ok) {
      this.logger.error(`service d’offres : statut ${response.status}`);
      throw new ServiceUnavailableException(
        'Le service d’offres a refusé la demande.',
      );
    }
    return response.json();
  }
}
