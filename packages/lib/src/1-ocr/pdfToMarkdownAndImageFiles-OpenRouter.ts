const MODEL_ALIASES: Record<string, string> = {
  gemini: "google/gemini-2.0-flash-exp",
  gpt: "openai/gpt-5.4",
};

export function getModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}
