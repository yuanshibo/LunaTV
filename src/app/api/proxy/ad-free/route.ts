/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getBaseUrl, resolveUrl } from "@/lib/live";

export const runtime = 'nodejs';

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

  // 按行分割M3U8内容
  const lines = m3u8Content.split('\n');
  const filteredLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 过滤广告标识
    if (line.includes('#EXT-X-DISCONTINUITY')) {
      continue;
    }

    // 重写 TS 切片地址
    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      // 根据 allowCORS 决定直接使用源地址或使用代理
      const proxyUrl = allowCORS ? resolvedUrl : `${proxyBase}/segment?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`; main
      filteredLines.push(proxyUrl);
      continue;
    }

    // 处理 EXT-X-MAP 标签中的 URI
    if (line.startsWith('#EXT-X-MAP:')) {
      line = rewriteMapUri(line, baseUrl, proxyBase, sourceParam);
    }

    // 处理 EXT-X-KEY 标签中的 URI
    if (line.startsWith('#EXT-X-KEY:')) {
      line = rewriteKeyUri(line, baseUrl, proxyBase, sourceParam);
    }

    // 处理嵌套的 M3U8 文件 (EXT-X-STREAM-INF)
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      filteredLines.push(line);
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          // 嵌套 M3U8 同样走到去广告代理接口
          const proxyUrl = `${proxyBase}/ad-free?url=${encodeURIComponent(resolvedUrl)}${sourceParam}`;
          filteredLines.push(proxyUrl);
        } else {
          filteredLines.push(nextLine);
        }
      }
      continue;
    }

    filteredLines.push(line);
  }

  return filteredLines.join('\n');
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
