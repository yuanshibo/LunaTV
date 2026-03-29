/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getBaseUrl, resolveUrl } from "@/lib/live";

export const runtime = 'nodejs';

// 结构化表示一个被 #EXT-X-DISCONTINUITY 分隔的序列
interface Sequence {
  lines: string[];
  durations: number[];
  totalDuration: number;
}

// 核心去广告算法：过滤掉 #EXT-X-DISCONTINUITY 相关的广告片段，并重写切片代理
function filterAdsFromM3U8(m3u8Content: string, baseUrl: string, req: Request, allowCORS: boolean, source?: string | null): string {
  if (!m3u8Content) return '';

  const referer = req.headers.get('referer');
  let protocol = 'http';

  // 1. Try x-forwarded-proto
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    protocol = forwardedProto.split(',')[0].trim();
  } else if (referer) {
    // 2. Fallback to referer
    try {
      const refererUrl = new URL(referer);
      protocol = refererUrl.protocol.replace(':', '');
    } catch (error) {
      // ignore
    }
  }

  // Fallback host if missing (though Next.js usually guarantees it)
  const host = req.headers.get('host') || 'localhost:3000';

  // 使用环境变量中配置的 SITE_BASE，如果没有则自动推断
  let proxyBase = `${protocol}://${host}/api/proxy`;
  if (process.env.SITE_BASE) {
    proxyBase = `${process.env.SITE_BASE}/api/proxy`;
  }

  const sourceParam = source ? `&moontv-source=${encodeURIComponent(source)}` : '';

  const rawLines = m3u8Content.split('\n');

  // 1. 第一遍扫描：将 M3U8 切分为多个 Sequence
  const sequences: Sequence[] = [];
  let currentSeq: Sequence = { lines: [], durations: [], totalDuration: 0 };
  const headerLines: string[] = []; // 存储开头的全局配置（直到第一个片段）
  let isHeader = true;

  // 辅助变量：记录当前片段的时长
  let currentExtInfDuration = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    // 处理全局 Header
    if (isHeader) {
       if (line.startsWith('#EXTINF:') || (line && !line.startsWith('#'))) {
           isHeader = false; // 遇到第一个切片数据，Header 结束
       } else {
           // 发现第一个不连续标记前，都算作 Header（如果第一行就是不连续的话）
           if (line.includes('#EXT-X-DISCONTINUITY')) {
               isHeader = false;
           } else {
               headerLines.push(line);
               continue;
           }
       }
    }

    // 遇到不连续标记，结束当前序列，开启新序列
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      if (currentSeq.lines.length > 0) {
        sequences.push(currentSeq);
      }
      currentSeq = { lines: [], durations: [], totalDuration: 0 };
      continue; // 不将 DISCONTINUITY 加入任何序列，我们后续按需重构
    }

    currentSeq.lines.push(line);

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        currentExtInfDuration = parseFloat(match[1]);
        currentSeq.durations.push(currentExtInfDuration);
        currentSeq.totalDuration += currentExtInfDuration;
      }
    }
  }
  if (currentSeq.lines.length > 0) {
    sequences.push(currentSeq);
  }

  // 2. 特征统计：计算所有切片时长的众数（最常见的切片时长，代表正片特征）
  const durationCounts: Record<string, number> = {};
  sequences.forEach(seq => {
    seq.durations.forEach(d => {
      // 对时长向下取整（例如 5.12 和 5.9 都看作 5 秒级别的切片）以便于统计
      const dKey = Math.floor(d).toString();
      durationCounts[dKey] = (durationCounts[dKey] || 0) + 1;
    });
  });

  let modeDurationStr = "0";
  let maxCount = 0;
  for (const [dur, count] of Object.entries(durationCounts)) {
    if (count > maxCount) {
      maxCount = count;
      modeDurationStr = dur;
    }
  }
  const modeDuration = parseInt(modeDurationStr, 10);

  // 3. 过滤序列：判断哪些序列是广告
  const validSequences: Sequence[] = [];

  for (const seq of sequences) {
    if (seq.durations.length === 0) {
      // 保留只有配置信息没有切片的序列（如 Master playlist 的 EXT-X-STREAM-INF）
      validSequences.push(seq);
      continue;
    }

    const avgDuration = seq.totalDuration / seq.durations.length;

    // 广告判定规则 (启发式特征)：
    // 1. 序列切片的平均时长，与正片常见时长偏差较大（例如相差 2 秒以上）
    // 2. 整个序列的总时长较短（通常广告片段总长不会超过 90 秒）
    const isDurationAnomalous = Math.abs(avgDuration - modeDuration) > 2;
    const isShortSequence = seq.totalDuration < 90;

    const isLikelyAd = isDurationAnomalous && isShortSequence;

    if (!isLikelyAd) {
      validSequences.push(seq);
    } else {
      console.log(`[Ad-Free] 拦截疑似广告片段: 包含 ${seq.durations.length} 个切片, 平均时长: ${avgDuration.toFixed(2)}s, 总时长: ${seq.totalDuration.toFixed(2)}s`);
    }
  }

  // 4. 重构 M3U8 文本，并应用代理重写逻辑
  const finalLines: string[] = [...headerLines];

  for (let sIdx = 0; sIdx < validSequences.length; sIdx++) {
    const seq = validSequences[sIdx];

    // 不同的有效序列之间，需要恢复 #EXT-X-DISCONTINUITY 标记以保证播放器正常衔接
    if (sIdx > 0 && seq.durations.length > 0 && finalLines.length > 0 && !finalLines[finalLines.length-1].includes('#EXT-X-DISCONTINUITY')) {
      finalLines.push('#EXT-X-DISCONTINUITY');
    }

    // 重写当前有效序列内的行
    for (let i = 0; i < seq.lines.length; i++) {
      let line = seq.lines[i];

      // 处理嵌套 M3U8 (EXT-X-STREAM-INF)
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        finalLines.push(line);
        if (i + 1 < seq.lines.length) {
          i++;
          const nextLine = seq.lines[i];
          if (nextLine && !nextLine.startsWith('#')) {
            const resolvedUrl = resolveUrl(baseUrl, nextLine);
            const proxyUrl = `${proxyBase}/ad-free?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`;
            finalLines.push(proxyUrl);
          } else {
            finalLines.push(nextLine);
          }
        }
        continue;
      }

      if (line.startsWith('#EXT-X-MAP:')) {
        line = rewriteMapUri(line, baseUrl, proxyBase, sourceParam);
      } else if (line.startsWith('#EXT-X-KEY:')) {
        line = rewriteKeyUri(line, baseUrl, proxyBase, sourceParam);
      } else if (line && !line.startsWith('#')) {
        // 重写 TS 切片地址
        const resolvedUrl = resolveUrl(baseUrl, line);
        line = allowCORS ? resolvedUrl : `${proxyBase}/segment?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`;
      }

      finalLines.push(line);
    }
  }

  return finalLines.join('\n');
}

function rewriteMapUri(line: string, baseUrl: string, proxyBase: string, sourceParam: string) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = `${proxyBase}/segment?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

function rewriteKeyUri(line: string, baseUrl: string, proxyBase: string, sourceParam: string) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = `${proxyBase}/key?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const source = searchParams.get('moontv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  const ua = liveSource?.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  let response: Response | null = null;
  let responseUsed = false;

  try {
    const decodedUrl = decodeURIComponent(url);

    response = await fetch(decodedUrl, {
      cache: 'no-cache',
      redirect: 'follow',
      headers: {
        'User-Agent': ua,
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch m3u8' }, { status: 500 });
    }

    const contentType = response.headers.get('Content-Type') || '';

    // 如果是 m3u8 文本，则进行过滤和重写
    if (contentType.toLowerCase().includes('mpegurl') || contentType.toLowerCase().includes('octet-stream')) {
      const finalUrl = response.url;
      const m3u8Content = await response.text();
      responseUsed = true;
      const baseUrl = getBaseUrl(finalUrl);

      const modifiedContent = filterAdsFromM3U8(m3u8Content, baseUrl, request, allowCORS, source);

      const headers = new Headers();
      headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Accept');
      headers.set('Cache-Control', 'no-cache');
      headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
      return new Response(modifiedContent, { headers });
    }

    // 如果返回的不是 m3u8，直接透传 (理论上不会走到这里，因为这个接口只用于 m3u8)
    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Accept');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    console.error('Ad-free proxy failed:', error);
    return NextResponse.json({ error: 'Proxy failed' }, { status: 500 });
  } finally {
    if (response && !responseUsed) {
      try {
        response.body?.cancel();
      } catch (e) {
        // ignore
        console.warn('Failed to close response body:', e);
      }
    }
  }
}
