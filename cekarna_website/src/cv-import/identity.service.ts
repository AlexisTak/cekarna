import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../config/environment';

@Injectable()
export class IdentityService {
  constructor(@Inject(ENVIRONMENT) private readonly config: Environment) {}
  async userId(authorization?: string): Promise<string> {
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Connectez-vous pour importer un CV.');
    const response = await fetch(this.config.authIdentityUrl, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    if (!response?.ok)
      throw new UnauthorizedException(
        'Votre session doit être renouvelée avant l’import.',
      );
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !body.id)
      throw new UnauthorizedException(
        'Votre session doit être renouvelée avant l’import.',
      );
    return body.id;
  }
}
