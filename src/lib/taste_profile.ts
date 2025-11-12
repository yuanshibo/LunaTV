
/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import { Ollama } from 'ollama';
import { sanitizeAndClean } from '@/lib/utils';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const ollama = new Ollama({ host: OLLAMA_HOST });

/**
 * Generates a user taste profile based on their watch and search history using an AI model.
 *
 * @param playRecords - A list of the user's playback records.
 * @param searchHistory - A list of the user's search queries.
 * @returns A promise that resolves to a string describing the user's taste profile.
 */
export async function generateTasteProfile(playRecords: any[], searchHistory: string[]): Promise<string> {
  const watchedTitles = playRecords.map(p => p.title).join(', ');
  const searchedTerms = searchHistory.join(', ');

  const prompt = `
    Based on the following user history, create a concise taste profile summarizing their likely preferences.
    Focus on genres, themes, and recurring actors or directors.

    Watched Movies/Shows: ${sanitizeAndClean(watchedTitles) || 'None'}
    Search History: ${sanitizeAndClean(searchedTerms) || 'None'}

    Example Profile: "This user seems to prefer science fiction movies, particularly those with dystopian themes. They also show an interest in high-fantasy TV series and have searched for works by director Christopher Nolan."

    Generate the profile:
  `;

  try {
    const response = await ollama.generate({
      model: 'llama2',
      prompt: prompt,
    });
    return response.response.trim();
  } catch (error) {
    console.error('Error generating taste profile with Ollama:', error);
    // Fallback to a simple, generic profile
    return 'Could not generate a detailed taste profile. User has watched some movies and shows.';
  }
}
