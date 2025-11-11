/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(
      JSON.stringify({ error: '搜索关键词不能为空' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 共享状态
  let streamClosed = false;

  // 创建可读流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 辅助函数：安全地向控制器写入数据
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed || (!controller.desiredSize && controller.desiredSize !== 0)) {
            // 流已标记为关闭或控制器已关闭
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          // 控制器已关闭或出现其他错误
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: apiSites.length,
        timestamp: Date.now()
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return; // 连接已关闭，提前退出
      }

      // 记录已完成的源数量
      let completedSources = 0;
      const allResults: any[] = [];

      // 为每个源创建搜索 Promise
      const searchPromises = apiSites.map(async (site) => {
        try {
          // 添加超时控制
          const searchPromise = Promise.race([
            searchFromApi(site, query),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
            ),
          ]);

          const results = await searchPromise as any[];

          // 过滤黄色内容
          let filteredResults = results;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = results.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          // 发送该源的搜索结果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return; // 连接已关闭，停止处理
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }

        } catch (error) {
          console.warn(`搜索失败 ${site.name}:`, error);

          // 发送源错误事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失败',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return; // 连接已关闭，停止处理
            }
          }
        }

        // 检查是否所有源都已完成
        if (completedSources === apiSites.length) {
          if (streamClosed) return;

          // If no results found, fallback to AI Assistant
          if (allResults.length === 0) {
            console.log('No direct results, falling back to AI Assistant within stream.');
            try {
              const aiResponse = await fetch('http://localhost:3000/api/ai/assistant', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': request.headers.get('cookie') || '',
                },
                body: JSON.stringify({ query }),
              });

              if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                if (aiData.results && aiData.results.length > 0) {
                  allResults.push(...aiData.results);
                  const aiSourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: 'ai_assistant',
                    sourceName: 'AI 推荐',
                    results: aiData.results,
                    responseText: aiData.responseText,
                    timestamp: Date.now()
                  })}\n\n`;
                  if (!safeEnqueue(encoder.encode(aiSourceEvent))) {
                    streamClosed = true;
                    return;
                  }
                }
              }
            } catch (aiError) {
              console.error('AI assistant fallback failed:', aiError);
            }
          }

          // 发送最终完成事件
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
            totalResults: allResults.length,
            completedSources,
            timestamp: Date.now()
          })}\n\n`;

          if (safeEnqueue(encoder.encode(completeEvent))) {
            try {
              controller.close();
            } catch (error) {
              console.warn('Failed to close controller:', error);
            }
          }
        }
      });

      // 等待所有搜索完成
      await Promise.allSettled(searchPromises);
    },

    cancel() {
      // 客户端断开连接时，标记流已关闭
      streamClosed = true;
      console.log('Client disconnected, cancelling search stream');
    },
  });

  // 返回流式响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
