/**
 * The engine's own steps and triggers, as a connector.
 *
 * They used to be auto-registered by `StepRegistry` / `TriggerRegistry`, which
 * meant every deployment got them whether or not it wanted them, and there was
 * no single object that could answer "what does this deployment provide?".
 * Registering them like anything else removes that special case — this
 * connector is exactly as privileged as one a host writes.
 *
 * Type IDs are UNCHANGED (`CODE`, `WAIT`, `HTTP_REQUEST`, `MANUAL`, …). They are
 * what stored workflows reference; the implementations moved folders, not
 * identities.
 */

import { BaseConnector } from '../core/base-connector.js';
import type { AnyStep, AnyTrigger } from '../core/base-connector.js';
import type { CredentialDefinition } from '../core/credentials.js';
import { declareSteps } from '../core/credentials.js';
import { BUILTIN_ALL_CREDENTIALS } from './credentials.js';

import { ClassifierAgentStep } from './steps/classifier-agent.step.js';
import { CodeStep } from './steps/code.step.js';
import { ConditionalStep } from './steps/conditional.step.js';
import { DedupStep } from './steps/dedup.step.js';
import { HttpRequestStep } from './steps/http-request.step.js';
import { FinishStep, GoToStep } from './steps/jump.step.js';
import { LoopStep } from './steps/loop.step.js';
import { MapStep } from './steps/map.step.js';
import { ParallelStep } from './steps/parallel.step.js';
import { CycleStep } from './steps/cycle.step.js';
import { SwitchStep } from './steps/switch.step.js';
import { DelayStep } from './steps/delay.step.js';
import { WaitForWebhookStep } from './steps/wait-for-webhook.step.js';
import { WaitForHumanStep } from './steps/wait-for-human.step.js';

import { DefaultManualTrigger } from './triggers/default-manual-trigger.js';
import { DefaultEventTrigger } from './triggers/default-event-trigger.js';
import { DefaultCronTrigger } from './triggers/default-cron-trigger.js';
import { DefaultWebhookV2Trigger } from './triggers/default-webhook-v2-trigger.js';

export class BuiltinConnector extends BaseConnector {
  override readonly id = 'builtin';
  override readonly version = '1.0.0';
  override readonly name = 'Built-in';
  override readonly description =
    "The engine's own steps and triggers — control flow, code, HTTP and the default triggers.";
  override readonly icon = 'blocks';



  /** The connector-less auth shapes `HTTP_REQUEST` accepts, plus the service a classifier asks. */
  override readonly credentials: readonly CredentialDefinition[] = [
    ...BUILTIN_ALL_CREDENTIALS,
  ];

  /**
   * Declared through `declareSteps`, which checks each step only accepts
   * credentials from the list above — in the editor, not at boot. The casts the
   * old array needed are gone with it.
   */
  override readonly steps: readonly AnyStep[] = declareSteps(BUILTIN_ALL_CREDENTIALS, [
    new FinishStep(),
    new ClassifierAgentStep(),
    new CodeStep(),
    new ConditionalStep(),
    new GoToStep(),
    new DedupStep(),
    new HttpRequestStep(),
    new LoopStep(),
    new MapStep(),
    new ParallelStep(),
    new CycleStep(),
    new SwitchStep(),
    new WaitForHumanStep(),
    new WaitForWebhookStep(),
    new DelayStep(),
  ]);

  override readonly triggers: readonly AnyTrigger[] = [
    new DefaultManualTrigger() as AnyTrigger,
    new DefaultEventTrigger() as AnyTrigger,
    new DefaultCronTrigger() as AnyTrigger,
    new DefaultWebhookV2Trigger() as AnyTrigger,
  ];
}
