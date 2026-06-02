const MODEL_ALIASES: Record<string, string> = {
  gemini: "google/gemini-2.0-flash-exp",
  "4o": "openai/gpt-4o",
};

export function getModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}
