import {
  defaultLlmRegistry,
  type LlmRefineInput,
  type LlmRefineOutput,
} from './llmProviders';

export type { LlmRefineInput, LlmRefineOutput };

export async function refineAutomationRulesWithGemini(
  input: LlmRefineInput,
): Promise<LlmRefineOutput> {
  return defaultLlmRegistry.refine({
    ...input,
    provider: input.provider ?? 'auto',
  });
}
