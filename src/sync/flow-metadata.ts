/**
 * Flow metadata sync — reconciles local flow metadata.yaml with the platform.
 *
 * Closes the gap behind GH issue #3 (push wiping flow event subscriptions and
 * title): before this module existed, push only updated skill scripts. Local
 * edits to flow title, events, or state_fields silently never reached the
 * platform; new events created via `newo create-event` had no path to flow
 * therefore disappeared from local metadata.yaml after a subsequent pull.
 *
 * Reconciliation strategy per flow (only runs when metadata.yaml hash changed):
 *  - Compare local FlowMetadata against fresh GET responses from the platform
 *  - Update flow title/description/runner via PATCH /api/v1/designer/flows/{id}
 *  - For each child collection (events, state_fields):
 *      • idn present locally + missing remotely → create
 *      • idn present in both, contents differ   → update
 *      • idn missing locally + present remotely → delete
 *
 * Hash-gating is critical: if the user never touched metadata.yaml, we never
 * compute a remote diff, which means a stale or partially-pulled tree cannot
 * accidentally wipe events that were created out-of-band via the Builder UI.
 */
import type { AxiosInstance } from 'axios';
import {
  listFlowEvents,
  listFlowStates,
  createFlowEvent,
  updateFlowEvent,
  deleteFlowEvent,
  createFlowState,
  updateFlowState,
  deleteFlowState,
  updateFlow
} from '../api.js';
import type {
  FlowMetadata,
  FlowEvent,
  FlowState,
  CreateFlowEventRequest,
  UpdateFlowEventRequest,
  CreateFlowStateRequest,
  UpdateFlowStateRequest,
  UpdateFlowRequest
} from '../types.js';

export interface FlowMetadataSyncCounts {
  flowsUpdated: number;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  statesCreated: number;
  statesUpdated: number;
  statesDeleted: number;
  errors: string[];
}

export function emptyFlowSyncCounts(): FlowMetadataSyncCounts {
  return {
    flowsUpdated: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    eventsDeleted: 0,
    statesCreated: 0,
    statesUpdated: 0,
    statesDeleted: 0,
    errors: []
  };
}

/**
 * True when remote FlowEvent fields differ from what the local metadata says.
 * We only compare semantic fields the platform stores - `id` is platform-owned.
 */
export function flowEventDiffers(local: FlowEvent, remote: FlowEvent): boolean {
  return (
    normalizeStr(local.description) !== normalizeStr(remote.description) ||
    normalizeStr(local.skill_selector) !== normalizeStr(remote.skill_selector) ||
    normalizeStr(local.skill_idn) !== normalizeStr(remote.skill_idn) ||
    normalizeStr(local.state_idn) !== normalizeStr(remote.state_idn) ||
    normalizeStr(local.interrupt_mode) !== normalizeStr(remote.interrupt_mode) ||
    normalizeStr(local.integration_idn) !== normalizeStr(remote.integration_idn) ||
    normalizeStr(local.connector_idn) !== normalizeStr(remote.connector_idn)
  );
}

export function flowStateDiffers(local: FlowState, remote: FlowState): boolean {
  return (
    normalizeStr(local.title) !== normalizeStr(remote.title) ||
    normalizeStr(local.default_value) !== normalizeStr(remote.default_value) ||
    normalizeStr(local.scope) !== normalizeStr(remote.scope)
  );
}

/**
 * Normalizes nullable/undefined string fields so YAML round-trips don't
 * register as differences. `null`, `undefined`, and missing all collapse to ''.
 */
function normalizeStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function buildEventCreateRequest(local: FlowEvent): CreateFlowEventRequest {
  return {
    idn: local.idn,
    description: local.description ?? '',
    skill_selector: local.skill_selector,
    ...(local.skill_idn != null ? { skill_idn: local.skill_idn } : {}),
    state_idn: local.state_idn ?? null,
    interrupt_mode: local.interrupt_mode,
    integration_idn: local.integration_idn ?? '',
    connector_idn: local.connector_idn ?? ''
  };
}

function buildEventUpdateRequest(local: FlowEvent): UpdateFlowEventRequest {
  return {
    idn: local.idn,
    description: local.description ?? '',
    skill_selector: local.skill_selector,
    skill_idn: local.skill_idn ?? null,
    state_idn: local.state_idn ?? null,
    interrupt_mode: local.interrupt_mode,
    integration_idn: local.integration_idn ?? null,
    connector_idn: local.connector_idn ?? null
  };
}

function buildStateCreateRequest(local: FlowState): CreateFlowStateRequest {
  const req: CreateFlowStateRequest = {
    title: local.title || local.idn,
    idn: local.idn,
    scope: local.scope
  };
  if (local.default_value != null) {
    req.default_value = local.default_value;
  }
  return req;
}

function buildStateUpdateRequest(local: FlowState): UpdateFlowStateRequest {
  const req: UpdateFlowStateRequest = {
    title: local.title || local.idn,
    idn: local.idn,
    scope: local.scope
  };
  if (local.default_value != null) {
    req.default_value = local.default_value;
  }
  return req;
}

function shouldUpdateFlow(local: FlowMetadata, remote: { title: string; description: string | null; default_runner_type?: string }): boolean {
  return (
    normalizeStr(local.title) !== normalizeStr(remote.title) ||
    normalizeStr(local.description) !== normalizeStr(remote.description) ||
    normalizeStr(local.default_runner_type) !== normalizeStr(remote.default_runner_type)
  );
}

/**
 * Reconcile one flow's metadata with the platform.
 *
 * @param client          authenticated Axios client
 * @param flowId          platform flow ID (UUID)
 * @param local           parsed FlowMetadata from the customer's local YAML
 * @param remoteFlow      flow data fetched from GET /flows/{id} - if null,
 *                        flow-level updates are skipped (still syncs children).
 *                        Pass null when caller already knows the GET endpoint
 *                        will 404 (e.g. legacy data) or wants children-only.
 * @param verbose         when true, emits per-operation log lines
 * @param counts          shared counter mutated in place across multiple flows
 */
export async function syncFlowMetadata(
  client: AxiosInstance,
  flowId: string,
  local: FlowMetadata,
  remoteFlow: { title: string; description: string | null; default_runner_type?: string } | null,
  verbose: boolean,
  counts: FlowMetadataSyncCounts
): Promise<void> {
  // 1. Flow-level fields (title, description, runner type)
  if (remoteFlow && shouldUpdateFlow(local, remoteFlow)) {
    try {
      const updateRequest: UpdateFlowRequest = {
        idn: local.idn,
        title: local.title,
        description: local.description ?? '',
        default_runner_type: local.default_runner_type,
        default_model: local.default_model
      };
      await updateFlow(client, flowId, updateRequest);
      counts.flowsUpdated++;
      if (verbose) {
        console.log(`    ↑ Updated flow metadata: ${local.idn} (title: "${remoteFlow.title}" → "${local.title}")`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      counts.errors.push(`Failed to update flow ${local.idn}: ${msg}`);
      console.error(`    ❌ Failed to update flow ${local.idn}: ${msg}`);
    }
  }

  // 2. Events
  let remoteEvents: FlowEvent[] = [];
  try {
    remoteEvents = await listFlowEvents(client, flowId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    counts.errors.push(`Failed to list events for flow ${local.idn}: ${msg}`);
    return;
  }

  const localEvents = local.events ?? [];
  const remoteByIdn = new Map(remoteEvents.map(e => [e.idn, e]));
  const localByIdn = new Map(localEvents.map(e => [e.idn, e]));

  // Create or update events present locally
  for (const localEvent of localEvents) {
    const remote = remoteByIdn.get(localEvent.idn);
    if (!remote) {
      // Create
      try {
        await createFlowEvent(client, flowId, buildEventCreateRequest(localEvent));
        counts.eventsCreated++;
        if (verbose) console.log(`    ↑ Created event: ${local.idn}/${localEvent.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to create event ${localEvent.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to create event ${localEvent.idn}: ${msg}`);
      }
    } else if (flowEventDiffers(localEvent, remote)) {
      try {
        await updateFlowEvent(client, remote.id, buildEventUpdateRequest(localEvent));
        counts.eventsUpdated++;
        if (verbose) console.log(`    ↑ Updated event: ${local.idn}/${localEvent.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to update event ${localEvent.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to update event ${localEvent.idn}: ${msg}`);
      }
    }
  }

  // Delete events present remotely but missing locally
  for (const remoteEvent of remoteEvents) {
    if (!localByIdn.has(remoteEvent.idn)) {
      try {
        await deleteFlowEvent(client, remoteEvent.id);
        counts.eventsDeleted++;
        if (verbose) console.log(`    ↑ Deleted event: ${local.idn}/${remoteEvent.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to delete event ${remoteEvent.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to delete event ${remoteEvent.idn}: ${msg}`);
      }
    }
  }

  // 3. State fields
  let remoteStates: FlowState[] = [];
  try {
    remoteStates = await listFlowStates(client, flowId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    counts.errors.push(`Failed to list states for flow ${local.idn}: ${msg}`);
    return;
  }

  const localStates = local.state_fields ?? [];
  const remoteStatesByIdn = new Map(remoteStates.map(s => [s.idn, s]));
  const localStatesByIdn = new Map(localStates.map(s => [s.idn, s]));

  for (const localState of localStates) {
    const remote = remoteStatesByIdn.get(localState.idn);
    if (!remote) {
      try {
        await createFlowState(client, flowId, buildStateCreateRequest(localState));
        counts.statesCreated++;
        if (verbose) console.log(`    ↑ Created state: ${local.idn}/${localState.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to create state ${localState.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to create state ${localState.idn}: ${msg}`);
      }
    } else if (flowStateDiffers(localState, remote)) {
      try {
        await updateFlowState(client, remote.id, buildStateUpdateRequest(localState));
        counts.statesUpdated++;
        if (verbose) console.log(`    ↑ Updated state: ${local.idn}/${localState.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to update state ${localState.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to update state ${localState.idn}: ${msg}`);
      }
    }
  }

  for (const remoteState of remoteStates) {
    if (!localStatesByIdn.has(remoteState.idn)) {
      try {
        await deleteFlowState(client, remoteState.id);
        counts.statesDeleted++;
        if (verbose) console.log(`    ↑ Deleted state: ${local.idn}/${remoteState.idn}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        counts.errors.push(`Failed to delete state ${remoteState.idn} in flow ${local.idn}: ${msg}`);
        console.error(`    ❌ Failed to delete state ${remoteState.idn}: ${msg}`);
      }
    }
  }
}

/**
 * Combined count of operations across all categories.
 */
export function totalFlowSyncOps(counts: FlowMetadataSyncCounts): number {
  return (
    counts.flowsUpdated +
    counts.eventsCreated + counts.eventsUpdated + counts.eventsDeleted +
    counts.statesCreated + counts.statesUpdated + counts.statesDeleted
  );
}

/**
 * Human-readable summary line for the push report.
 */
export function describeFlowSyncCounts(counts: FlowMetadataSyncCounts): string {
  const parts: string[] = [];
  if (counts.flowsUpdated) parts.push(`${counts.flowsUpdated} flow(s)`);
  if (counts.eventsCreated || counts.eventsUpdated || counts.eventsDeleted) {
    const eventOps: string[] = [];
    if (counts.eventsCreated) eventOps.push(`+${counts.eventsCreated}`);
    if (counts.eventsUpdated) eventOps.push(`~${counts.eventsUpdated}`);
    if (counts.eventsDeleted) eventOps.push(`-${counts.eventsDeleted}`);
    parts.push(`events ${eventOps.join('/')}`);
  }
  if (counts.statesCreated || counts.statesUpdated || counts.statesDeleted) {
    const stateOps: string[] = [];
    if (counts.statesCreated) stateOps.push(`+${counts.statesCreated}`);
    if (counts.statesUpdated) stateOps.push(`~${counts.statesUpdated}`);
    if (counts.statesDeleted) stateOps.push(`-${counts.statesDeleted}`);
    parts.push(`states ${stateOps.join('/')}`);
  }
  return parts.join(', ');
}
