import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from './config/environment';

export type DependencyState = 'up' | 'down' | 'not_configured';

export interface DependencyReadiness {
  status: DependencyState;
  latency_ms: number;
  detail?: 'unreachable' | 'http_error' | 'model_missing';
  model?: string;
}

export interface ReadinessReport {
  status: 'ready' | 'degraded';
  dependencies: {
    identity: DependencyReadiness;
    offers: DependencyReadiness;
    hermes: DependencyReadiness;
  };
}

function readinessUrl(identityUrl: string) {
  const url = new URL(identityUrl);
  url.pathname = '/health/ready';
  url.search = '';
  url.hash = '';
  return url.toString();
}

@Injectable()
export class ReadinessService {
  constructor(@Inject(ENVIRONMENT) private readonly config: Environment) {}

  async check(): Promise<ReadinessReport> {
    const model = this.config.hermesModel;
    const [identity, offers, hermes] = await Promise.all([
      this.probe(readinessUrl(this.config.authIdentityUrl)),
      this.config.offersInternalToken
        ? this.probe(`${this.config.offersBaseUrl}/health/ready`)
        : Promise.resolve<DependencyReadiness>({
            status: 'not_configured',
            latency_ms: 0,
          }),
      this.probeHermes(
        `${this.config.hermesBaseUrl}/api/tags`,
        model,
        this.config.hermesApiKey,
      ),
    ]);
    const dependencies = { identity, offers, hermes };
    return {
      status: Object.values(dependencies).every(
        (dependency) => dependency.status === 'up',
      )
        ? 'ready'
        : 'degraded',
      dependencies,
    };
  }

  private async probe(url: string): Promise<DependencyReadiness> {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok
        ? { status: 'up', latency_ms: Date.now() - startedAt }
        : {
            status: 'down',
            latency_ms: Date.now() - startedAt,
            detail: 'http_error',
          };
    } catch {
      return {
        status: 'down',
        latency_ms: Date.now() - startedAt,
        detail: 'unreachable',
      };
    }
  }

  private async probeHermes(
    url: string,
    model: string,
    apiKey: string,
  ): Promise<DependencyReadiness> {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok)
        return {
          status: 'down',
          latency_ms: Date.now() - startedAt,
          detail: 'http_error',
          model,
        };
      const body = (await response.json()) as { models?: unknown };
      const available = Array.isArray(body.models)
        ? body.models.some((value) => {
            if (!value || typeof value !== 'object') return false;
            const item = value as Record<string, unknown>;
            return item.name === model || item.model === model;
          })
        : false;
      return {
        status: available ? 'up' : 'down',
        latency_ms: Date.now() - startedAt,
        detail: available ? undefined : 'model_missing',
        model,
      };
    } catch {
      return {
        status: 'down',
        latency_ms: Date.now() - startedAt,
        detail: 'unreachable',
        model,
      };
    }
  }
}
