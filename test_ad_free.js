const fs = require('fs');
const url = require('url');

// Mock request
const req = {
  headers: new Map([
    ['host', '192.168.10.103:3000']
  ])
};

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).toString();
  } catch (e) {
    return relative;
  }
}

function filterAdsFromM3U8(m3u8Content, baseUrl, req, allowCORS) {
  if (!m3u8Content) return '';

  const referer = req.headers.get('referer');
  let protocol = 'http';
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      protocol = refererUrl.protocol.replace(':', '');
    } catch (error) {
      // ignore
    }
  }

  const host = req.headers.get('host');
  const proxyBase = `${protocol}://${host}/api/proxy`;

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
      const proxyUrl = allowCORS ? resolvedUrl : `${proxyBase}/segment?url=${encodeURIComponent(resolvedUrl)}`;
      filteredLines.push(proxyUrl);
      continue;
    }

    // 处理 EXT-X-MAP 标签中的 URI
    if (line.startsWith('#EXT-X-MAP:')) {
      line = rewriteMapUri(line, baseUrl, proxyBase);
    }

    // 处理 EXT-X-KEY 标签中的 URI
    if (line.startsWith('#EXT-X-KEY:')) {
      line = rewriteKeyUri(line, baseUrl, proxyBase);
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
          const proxyUrl = `${proxyBase}/ad-free?url=${encodeURIComponent(resolvedUrl)}`;
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

function rewriteMapUri(line, baseUrl, proxyBase) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = `${proxyBase}/segment?url=${encodeURIComponent(resolvedUrl)}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

function rewriteKeyUri(line, baseUrl, proxyBase) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = `${proxyBase}/key?url=${encodeURIComponent(resolvedUrl)}`;
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

const input = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2357000,RESOLUTION=1920x800
/20260317/R1DGXhd4/2357kb/hls/index.m3u8`;

const out = filterAdsFromM3U8(input, "https://vodcnd11.myqqdd.com/20260317/R1DGXhd4/index.m3u8", req, false);
console.log(out);

const input2 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-KEY:METHOD=AES-128,URI="/20260317/R1DGXhd4/2357kb/hls/key.key",IV=0x00000000000000000000000000000000
#EXTINF:2,
/20260317/R1DGXhd4/2357kb/hls/WzE0g8Tp.ts`;
const out2 = filterAdsFromM3U8(input2, "https://vodcnd11.myqqdd.com/20260317/R1DGXhd4/2357kb/hls/index.m3u8", req, false);
console.log("\n\n" + out2);
