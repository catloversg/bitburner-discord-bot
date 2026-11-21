import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handleDiscordRequest } from "./core.ts";

const { DISCORD_APPLICATION_ID, DISCORD_BOT_PUBLIC_KEY, DISCORD_BOT_TOKEN } = process.env;

if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_PUBLIC_KEY || !DISCORD_BOT_TOKEN) {
  throw new Error("Missing required environment variables");
}

function toWebHeaders(nodeHeaders: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

const server = http.createServer(async (request, response) => {
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    // handleDiscordRequest only reads the request headers and body, so the URL's origin and path are irrelevant.
    // If the handler needs the original URL in the future (e.g., for logging), use the actual request URL instead.
    const webRequest = new Request("http://localhost", {
      method: request.method,
      headers: toWebHeaders(request.headers),
      body: hasBody ? Readable.toWeb(request) : null,
      // Node.js requires duplex: "half" when using a streaming Request body.
      // Readable.toWeb(req) creates a ReadableStream, so duplex must be set whenever the request has a body.
      duplex: hasBody ? "half" : undefined,
    } as RequestInit);

    const webResponse = await handleDiscordRequest(webRequest);
    response.statusCode = webResponse.status;
    response.setHeaders(webResponse.headers);
    if (webResponse.body) {
      await pipeline(Readable.fromWeb(webResponse.body), response);
    } else {
      response.end();
    }
  } catch (error) {
    console.error("Server error:", error);

    if (!response.headersSent) {
      response.writeHead(500);
      response.end("Internal Server Error");
    } else if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  }
});

server.listen(3000, "127.0.0.1");
