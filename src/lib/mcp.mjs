//------------------------------------------------------------------------------------
// mcp.mjs -- Part of RStellarisGui
//
// A dependency-free Model Context Protocol server over stdio, matching the shape and
// observable behaviour of RStellarisScribe's lib/mcp.mjs (which is itself a port of
// RHoiScribe's `rmcp`-based server). Transport: newline-delimited JSON-RPC 2.0 on
// stdin/stdout, diagnostics on stderr, never stdout.
//
// One addition over the sibling project: `gui_layout_preview` can return an MCP `image`
// content block, because the whole point of this server is to give an agent that cannot see
// the game something visual to reason about. A tool returns
// `{__mcpContent: [...]}` to control its own content array.
//
// This program is free software: you can redistribute it and/or modify it under the terms
// of the GNU Affero General Public License as published by the Free Software Foundation,
// either version 3 of the License, or (at your option) any later version.
//------------------------------------------------------------------------------------

export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Create a request handler over a registry of tools and (optionally) resources. */
export function createHandler(registry) {
  return async function handle(message) {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    const resources = registry.resources ?? null;

    try {
      switch (method) {
        case 'initialize':
          return respond(id, {
            protocolVersion: negotiateProtocol(params?.protocolVersion),
            capabilities: {
              tools: { listChanged: false },
              // Only advertise resources when the registry actually has them, so an MCP client is
              // never told to call `resources/read` on a server that would answer -32601.
              ...(resources ? { resources: { subscribe: false, listChanged: false } } : {}),
            },
            serverInfo: registry.serverInfo,
            instructions: registry.instructions,
          });

        case 'notifications/initialized':
        case 'notifications/cancelled':
        case 'notifications/roots/list_changed':
          return null;

        case 'ping':
          return respond(id, {});

        case 'tools/list':
          return respond(id, { tools: registry.tools.list() });

        case 'tools/call': {
          const result = await registry.tools.call(params?.name, params?.arguments ?? {});
          return respond(id, toolResult(result));
        }

        case 'resources/list':
          if (!resources) return error(id, -32601, 'method not found: resources/list');
          return respond(id, { resources: resources.list() });

        case 'resources/templates/list':
          if (!resources) return error(id, -32601, 'method not found: resources/templates/list');
          return respond(id, { resourceTemplates: resources.templates?.() ?? [] });

        case 'resources/read': {
          if (!resources) return error(id, -32601, 'method not found: resources/read');
          const uri = params?.uri;
          if (typeof uri !== 'string' || uri === '') {
            return error(id, -32602, '`uri` is required and must be a non-empty string');
          }
          const resource = await resources.read(uri);
          return respond(id, { contents: [resource] });
        }

        default:
          if (isNotification) return null;
          return error(id, -32601, `method not found: ${method}`);
      }
    } catch (thrown) {
      const text = thrown instanceof Error ? thrown.message : String(thrown);
      // A bad argument is a protocol-level `invalid_params`, matching the sibling server, so a
      // caller can distinguish "you asked wrongly" from "the tool ran and failed". A bad resource
      // URI is the same class, which is why `resources.read` raises a ToolError.
      if (thrown && thrown.name === 'ToolError') {
        return error(id, -32602, text);
      }
      if (method === 'tools/call') {
        return respond(id, { content: [{ type: 'text', text }], isError: true });
      }
      return error(id, -32603, text);
    }
  };
}

/** Wrap a tool return value as an MCP tool result. */
export function toolResult(value) {
  if (value && typeof value === 'object' && value.__mcpContent) {
    return { content: value.__mcpContent };
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Serve the handler over stdio until stdin closes. */
export function runStdio(handler, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    let buffer = '';
    input.setEncoding('utf8');

    input.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === '') continue;
        dispatch(line);
      }
    });

    input.on('end', () => {
      if (buffer.trim() !== '') dispatch(buffer.trim());
      resolve();
    });

    async function dispatch(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch (thrown) {
        write(error(null, -32700, `invalid JSON: ${thrown.message}`));
        return;
      }
      const response = await handler(message);
      if (response !== null && response !== undefined) write(response);
    }

    function write(value) {
      output.write(JSON.stringify(value) + '\n');
    }
  });
}

function respond(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function negotiateProtocol(requested) {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

/** A tool-argument error: surfaced as JSON-RPC `invalid_params`, not as a failed tool result. */
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Require a string argument. */
export function requireString(args, name, hint = '') {
  const value = args?.[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError(`\`${name}\` is required and must be a non-empty string${hint ? ` (${hint})` : ''}`);
  }
  return value;
}

/** Require an object argument. */
export function requireObject(args, name) {
  const value = args?.[name];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError(`\`${name}\` is required and must be an object`);
  }
  return value;
}

export default { createHandler, toolResult, runStdio, ToolError, requireString, requireObject };
