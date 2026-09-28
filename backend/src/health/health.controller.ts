import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

type DependencyState = 'up' | 'down';

/**
 * Readiness for load balancers and deploy pipelines. `GET /health` stays cheap
 * and dependency-free; `GET /health/ready` actually touches Postgres and the
 * document bucket, so a deploy fails loudly rather than serving broken traffic.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{
    status: DependencyState;
    dependencies: { database: DependencyState; storage: DependencyState };
  }> {
    const [database, storage] = await Promise.all([
      this.prisma.ping().then((): DependencyState => 'up').catch((): DependencyState => 'down'),
      this.storage.isReachable().then((ok): DependencyState => (ok ? 'up' : 'down')),
    ]);

    return {
      status: database === 'up' && storage === 'up' ? 'up' : 'down',
      dependencies: { database, storage },
    };
  }
}
