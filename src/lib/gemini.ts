/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import {
  GoogleGenAI,
  GenerationConfig,
  Content,
} from '@google/genai';

// 定义一个函数，用于调用 Gemini API 生成内容
export async function generateContentWithGemini(
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<string> {
  // 检查 API Key 是否提供
  if (!apiKey) {
    throw new Error('Gemini API key is not configured.');
  }

  try {
    // 初始化 GoogleGenAI 实例
    const genAI = new GoogleGenAI(apiKey);

    // 获取指定的生成模型
    const model = genAI.getGenerativeModel({ model: modelName });

    // 定义生成配置（可选）
    const generationConfig: GenerationConfig = {
      temperature: 0.9,
      topK: 1,
      topP: 1,
      maxOutputTokens: 2048,
    };

    // 构建请求内容
    const parts: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];

    // 调用 API 生成内容
    const result = await model.generateContent({
      contents: parts,
      generationConfig,
    });

    // 检查是否有候选内容返回
    if (!result.response.candidates || result.response.candidates.length === 0) {
      throw new Error('No content generated from Gemini.');
    }

    // 获取第一个候选内容的文本
    const generatedText = result.response.candidates[0].content.parts[0].text;

    if (!generatedText) {
      throw new Error('Empty response from Gemini');
    }

    return generatedText;
  } catch (error) {
    console.error('Error calling Gemini API:', error);

    // 重新抛出错误，以便上层调用者可以捕获
    throw new Error(`Failed to generate content with Gemini: ${(error as Error).message}`);
  }
}
