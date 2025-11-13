/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

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
    // 动态导入正确的包 @google/generative-ai
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    // 使用正确的类名 GoogleGenerativeAI 初始化
    const genAI = new GoogleGenerativeAI(apiKey);

    // 获取生成模型
    const model = genAI.getGenerativeModel({ model: modelName });

    // 定义生成配置
    const generationConfig = {
      temperature: 0.9,
      topK: 1,
      topP: 1,
      maxOutputTokens: 2048,
    };

    // 调用 API 生成内容
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedText = response.text();

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
