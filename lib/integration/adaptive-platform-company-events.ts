import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type CompanyEventInitiator = {
  issuer: string;
  subject: string;
  displayName?: string;
};

type ClaimedEvent = {
  event_id: string;
  event_type: 'company.created' | 'company.updated';
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_id: string;
};

export type CompanyEventDispatchResult = {
  configured: boolean;
  claimed: number;
  delivered: number;
  failed: number;
};

let serviceClient: SupabaseClient | undefined;

export async function dispatchPendingCompanyEvents(options: {
  aggregateId?: string;
  initiator?: CompanyEventInitiator;
  limit?: number;
} = {}): Promise<CompanyEventDispatchResult> {
  const configuration = loadConfiguration();
  if (configuration === undefined) return { configured: false, claimed: 0, delivered: 0, failed: 0 };
  const database = getServiceClient(configuration.supabaseUrl, configuration.supabaseSecret);
  const leaseId = randomUUID();
  const { data, error } = await database.rpc('jde_claim_adaptive_platform_events', {
    p_limit: Math.min(100, Math.max(1, options.limit ?? 20)),
    p_aggregate_id: options.aggregateId ?? null,
    p_lease_id: leaseId,
  });
  if (error) throw new Error(`Could not claim adaptive-platform company events: ${error.message}`);
  const events = (data ?? []) as ClaimedEvent[];
  let delivered = 0;
  let failed = 0;
  for (const event of events) {
    const payload =
      options.initiator === undefined
        ? event.payload
        : { ...event.payload, initiator: options.initiator };
    if (options.initiator !== undefined) {
      const { error: persistError } = await database
        .from('jde_adaptive_platform_outbox')
        .update({ payload, updated_at: new Date().toISOString() })
        .eq('event_id', event.event_id)
        .eq('lease_id', event.lease_id);
      if (persistError) {
        await releaseFailure(database, event, `Could not persist event initiator: ${persistError.message}`);
        failed += 1;
        continue;
      }
    }
    try {
      await deliverEvent(configuration.platformUrl, configuration.eventSecret, payload);
      const { error: completeError } = await database
        .from('jde_adaptive_platform_outbox')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          lease_id: null,
          lease_until: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('event_id', event.event_id)
        .eq('lease_id', event.lease_id);
      if (completeError) throw new Error(`Could not mark the event delivered: ${completeError.message}`);
      delivered += 1;
    } catch (error: unknown) {
      await releaseFailure(database, event, error instanceof Error ? error.message : 'Unknown delivery error.');
      failed += 1;
    }
  }
  return { configured: true, claimed: events.length, delivered, failed };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function deliverEvent(platformUrl: URL, secret: string, payload: Record<string, unknown>): Promise<void> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = `v1=${createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalJson(payload)}`)
    .digest('hex')}`;
  const endpoint = new URL('/v1/internal/erp/company-events', platformUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-erp-event-timestamp': timestamp,
      'x-erp-event-signature': signature,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Adaptive platform rejected the company event (${response.status}): ${body}`);
  }
}

async function releaseFailure(database: SupabaseClient, event: ClaimedEvent, message: string): Promise<void> {
  const deadLetter = event.attempt_count >= 10;
  const delayMinutes = Math.min(1_440, 2 ** Math.min(event.attempt_count, 10));
  const { error } = await database
    .from('jde_adaptive_platform_outbox')
    .update({
      status: deadLetter ? 'dead_letter' : 'queued',
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      lease_id: null,
      lease_until: null,
      last_error: message.slice(0, 2_000),
      updated_at: new Date().toISOString(),
    })
    .eq('event_id', event.event_id)
    .eq('lease_id', event.lease_id);
  if (error) throw new Error(`Could not release the failed company event: ${error.message}`);
}

function loadConfiguration():
  | { platformUrl: URL; eventSecret: string; supabaseUrl: string; supabaseSecret: string }
  | undefined {
  const platformValue = process.env.ADAPTIVE_PLATFORM_BASE_URL;
  const eventSecret = process.env.ERP_COMPANY_EVENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!platformValue || !eventSecret) return undefined;
  if (!supabaseUrl || !supabaseSecret) throw new Error('Supabase service credentials are not configured.');
  if (eventSecret.length < 32) throw new Error('ERP_COMPANY_EVENT_SECRET must contain at least 32 characters.');
  const platformUrl = new URL(platformValue);
  if (platformUrl.protocol !== 'https:' && platformUrl.hostname !== 'localhost' && platformUrl.hostname !== '127.0.0.1') {
    throw new Error('ADAPTIVE_PLATFORM_BASE_URL must use HTTPS outside localhost.');
  }
  return { platformUrl, eventSecret, supabaseUrl, supabaseSecret };
}

function getServiceClient(url: string, secret: string): SupabaseClient {
  serviceClient ??= createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}
