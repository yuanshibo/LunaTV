
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { NextRequest } from 'next/server';
import { WebSocketServer, WebSocket } from 'ws';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAiRecommendations, directSearch } from '@/lib/search';

// This is a global WebSocket server instance.
// In a real-world serverless environment, you'd manage this differently,
// but for this setup, it's the most straightforward way.
let wss: WebSocketServer | null = null;

const initWebSocketServer = () => {
  if (wss) {
    return wss;
  }

  // Note: This setup won't work correctly on standard Vercel deployments.
  // It requires a long-running Node.js environment.
  console.log('Initializing WebSocket server...');
  wss = new WebSocketServer({ noServer: true }); // We attach it to the HTTP server manually

  wss.on('connection', async (ws: WebSocket, request: NextRequest) => {
    console.log('WebSocket client connected');

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      console.log('WebSocket connection rejected: Unauthorized');
      ws.send(JSON.stringify({ error: 'Unauthorized' }));
      ws.close();
      return;
    }

    ws.on('message', async (message: string) => {
      try {
        const { query } = JSON.parse(message);
        if (!query) {
          ws.send(JSON.stringify({ error: 'Query is required' }));
          return;
        }

        console.log(`Received search query: ${query}`);

        // 1. Perform direct search and stream results
        let resultsFound = false;
        for await (const batch of directSearch(query, authInfo.username)) {
          if (batch.length > 0) {
            resultsFound = true;
            ws.send(JSON.stringify({ event: 'batch', results: batch }));
          }
        }

        // 2. If no direct results, fall back to AI recommendations
        if (!resultsFound) {
          console.log('No direct results found, falling back to AI.');
          const aiResults = await getAiRecommendations(query, authInfo.username);
          // Send AI results as a single batch
          if (aiResults.length > 0) {
            ws.send(JSON.stringify({ event: 'batch', results: aiResults }));
          }
        }

        // 3. Signal that the search is complete
        ws.send(JSON.stringify({ event: 'done' }));
        console.log('Search process completed for query:', query);

      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({ error: 'An internal error occurred.' }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  console.log('WebSocket server initialized.');
  return wss;
};

// Initialize the server on module load
initWebSocketServer();

// The GET handler is now responsible for upgrading the HTTP connection to a WebSocket connection.
export async function GET(request: NextRequest) {
  const server = (request.headers as any).get('x-next-server');
  if (!server || !server.app || !server.app.server) {
    return new Response('WebSocket upgrade failed: Server not available', { status: 500 });
  }

  const wssInstance = initWebSocketServer();

  server.app.server.on('upgrade', (req: any, socket: any, head: any) => {
    // Ensure we are only handling requests for this specific API route
    if (req.url === '/api/search/ws') {
      wssInstance.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wssInstance.emit('connection', ws, request);
      });
    }
  });

  return new Response(null, { status: 101 });
}
