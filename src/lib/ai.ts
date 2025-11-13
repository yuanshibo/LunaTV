/* eslint-disable no-console */
import { db } from './db';
import { generateContentWithGemini } from './gemini';

const OLLAMA_HOST_DEFAULT = 'http://localhost:11434';

/**
 * The primary AI content generation function for the application.
 * It dynamically selects the AI provider based on admin configuration
 * and handles automatic fallback to Ollama if the primary provider (Gemini) fails.
 *
 * @param prompt The text prompt to send to the AI.
 * @param isJson A boolean indicating whether to expect a JSON formatted string in response.
 * @returns A promise that resolves to the generated content, either as a string or a parsed JSON object.
 */
export async function generateContent(prompt: string, isJson = false): Promise<any> {
  const config = await db.getAdminConfig();

  const provider = config?.SiteConfig.aiProvider || 'ollama';
  const geminiApiKey = config?.SiteConfig.geminiApiKey;

  // 1. Try Gemini if it's the selected provider and has an API key.
  if (provider === 'gemini' && geminiApiKey) {
    try {
      const modelName = config.SiteConfig.gemini_model || 'gemini-pro';
      console.log(`Attempting to generate content with Gemini (model: ${modelName}).`);
      const result = await generateContentWithGemini(geminiApiKey, modelName, prompt);
      return isJson ? JSON.parse(result) : result;
    } catch (error) {
      console.error(
        `Gemini API call failed. Error: ${(error as Error).message}. ` +
        'Falling back to Ollama.'
      );
      // Fallback to Ollama below, do not re-throw.
    }
  }

  // 2. Fallback to Ollama if it's the selected provider, or if Gemini failed.
  console.log('Generating content with Ollama.');
  const ollamaHost = config?.SiteConfig.ollama_host || OLLAMA_HOST_DEFAULT;
  const modelName = config?.SiteConfig.ollama_model || 'llama3';

  const body = {
    model: modelName,
    prompt: prompt,
    stream: false,
    ...(isJson ? { format: 'json' } : {}),
  };

  console.log('Ollama request:', JSON.stringify({ model: body.model, prompt: body.prompt, format: body.format }, null, 2));

  // The fetch call for Ollama must be wrapped in a try...catch as well.
  try {
    const ollamaUrl = `${ollamaHost}/api/generate`;
    console.log(`Fetching Ollama at: ${ollamaUrl}`);
    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama API request failed with status ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { context, ...logData } = data;
    console.log('Ollama response:', JSON.stringify(logData, null, 2));

    if (data.done === false) {
      throw new Error('Ollama response was not complete.');
    }

    return isJson ? JSON.parse(data.response) : data.response;
  } catch (error) {
    console.error(`Ollama API call failed. Error: ${(error as Error).message}`);
    // This is the final fallback. If it fails, throw the error.
    throw error;
  }
}
