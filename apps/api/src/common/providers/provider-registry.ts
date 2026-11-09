import { Injectable, Logger } from '@nestjs/common';

export type ProviderMode = 'live' | 'stand-in';

export interface ProviderRegistration {
  /** The outside system this adapter speaks to, as a deployment would name it. */
  name: string;
  mode: ProviderMode;
  /**
   * The setting that selects the adapter, so a refusal can say what to change.
   * Omitted while no live adapter exists to select, rather than naming a
   * setting an operator would look for and not find.
   */
  setting?: string;
}

/**
 * Every adapter for an outside system registers itself here at start-up,
 * declaring whether it is talking to the real provider or standing in for one.
 *
 * A stand-in is how a provider is developed and tested before its live adapter
 * exists. `assertNoStandInsInProduction` is the single gate that keeps one from
 * reaching production, so no adapter has to carry an environment check of its
 * own.
 *
 * Registrations hold a name, a mode and a setting name. Credentials, endpoints
 * and keys stay inside the adapter that uses them.
 */
@Injectable()
export class ProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>();

  register(registration: ProviderRegistration): void {
    this.registrations.set(registration.name, registration);
  }

  list(): ProviderRegistration[] {
    return [...this.registrations.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  standIns(): ProviderRegistration[] {
    return this.list().filter((registration) => registration.mode === 'stand-in');
  }

  /**
   * Refuses to carry on when a production deployment would run on a simulated
   * provider. The message names the providers and the settings that select
   * them; it never prints a value.
   */
  assertNoStandInsInProduction(nodeEnv: string): void {
    if (nodeEnv !== 'production') return;
    const standIns = this.standIns();
    if (standIns.length === 0) return;

    const named = standIns
      .map(({ name, setting }) => `${name} (${setting ?? 'no live adapter yet'})`)
      .join(', ');
    throw new Error(
      `Refusing to start in production on simulated providers: ${named}. ` +
        'Configure a live adapter for each, or deploy a non-production environment.',
    );
  }

  /** Outside production, make it obvious in the log what is being simulated. */
  report(nodeEnv: string, logger = new Logger(ProviderRegistry.name)): void {
    if (nodeEnv === 'production') return;
    for (const { name, mode, setting } of this.list()) {
      logger.log(`${name}: ${mode}${setting ? ` (${setting})` : ''}`);
    }
  }
}
