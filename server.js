'use strict';

const http = require('node:http');

const DEFAULT_PORT = 3000;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const HELLO_PATH = '/hello';
const HELLO_RESPONSE_BODY = 'Hello world';
const NOT_FOUND_RESPONSE_BODY = 'Not Found';
const CONTENT_TYPE = 'text/plain';

// The one server instance, so the SIGINT handler can close it.
let server = null;
// The port in effect, so the SIGINT handler can name it without a parameter.
let activePort = null;

function sendText(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', CONTENT_TYPE);
  res.end(body);
}

function handleHelloRequest(req, res) {
  sendText(res, 200, HELLO_RESPONSE_BODY);
}

function handleNotFoundRequest(req, res) {
  sendText(res, 404, NOT_FOUND_RESPONSE_BODY);
}

// The one response path for a request that never reaches a ServerResponse, where sendText has no
// response object to write to: the same 404 contract, framed by hand and closed because a
// rejected connection cannot be reused.
function sendRawNotFound(socket) {
  // The socket handed to a diverted CONNECT arrives without an 'error' listener — Node removes its
  // own when it diverts — so a write error on it (a peer that resets mid-404) would be an unhandled
  // 'error' event and take the process down. A write error means the connection is unusable, so the
  // socket is destroyed; the call is idempotent.
  socket.on('error', () => {
    socket.destroy();
  });

  socket.end(
    'HTTP/1.1 404 Not Found\r\n' +
      `Content-Type: ${CONTENT_TYPE}\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `Content-Length: ${NOT_FOUND_RESPONSE_BODY.length}\r\n` +
      'Connection: close\r\n' +
      '\r\n' +
      NOT_FOUND_RESPONSE_BODY,
  );
}

// Resolve a request target to the value routing compares and every log site carries, dropping the
// query string and fragment. Shared by all of them so the resolved path cannot differ.
function resolveTargetPath(target) {
  try {
    return new URL(target, 'http://localhost').pathname;
  } catch {
    // A target the URL constructor rejects, such as `http://[`, falls back to the raw
    // target so the request is answered with the 404 instead of crashing the process.
    return target;
  }
}

function requestPath(req) {
  return resolveTargetPath(req.url);
}

// The path a log line carries: the resolved pathname, and — for a target the URL constructor
// rejects, where the raw target stands in for it — the raw target cut at its first `?` or `#`, so
// a query string or fragment never reaches the log line.
function pathForLog(target) {
  return resolveTargetPath(target).split(/[?#]/)[0];
}

function logRequest(method, path) {
  process.stdout.write(`[${new Date().toISOString()}] [${method}] [${path}]\n`);
}

// A log field that cannot forge a log line: printable ASCII only, otherwise a placeholder.
function logField(value) {
  return /^[\x21-\x7e]+$/.test(value) ? value : '-';
}

// Log a parser-rejected request from the bytes the parser read, so it still gets its one line and
// its path is resolved exactly as a routed request's would be.
function logRejectedRequest(rawPacket) {
  const firstLine = Buffer.isBuffer(rawPacket) ? rawPacket.toString('latin1').split('\n', 1)[0] : '';
  const fields = /^([^ \t]+)[ \t]+([^ \t]+)/.exec(firstLine);

  if (fields === null) {
    logRequest('-', '-');
  } else {
    // The path is resolved first, exactly as a routed request's is, and sanitised afterwards, so a
    // target that survives resolution cannot carry a byte into the log that breaks its one line.
    // Upper-case the recovered token after the guard, so its line matches a routed request's.
    logRequest(logField(fields[1]).toUpperCase(), logField(pathForLog(fields[2])));
  }
}

function handleRequest(req, res) {
  const path = requestPath(req);

  // Routing uses `path`; the logged path comes from `pathForLog`, which keeps the query
  // string and fragment out of the log line.
  logRequest(req.method, pathForLog(req.url));

  if (req.method === 'GET' && path === HELLO_PATH) {
    handleHelloRequest(req, res);
  } else {
    handleNotFoundRequest(req, res);
  }
}

// The server's 'clientError' listener: a request the HTTP parser rejects never reaches
// handleRequest, so it is logged and answered with the catch-all 404 contract here. An aborted
// connection, or a socket whose request is already answered, is dropped instead: either the
// response is still attached to it with its header written, or the parser is still inside a message
// whose head it completed, which handleRequest answered — a fresh rejection still gets its line.
function handleClientError(err, socket) {
  const responseInFlight = socket._httpMessage;
  const unfinishedMessage = socket.parser && socket.parser.incoming;

  if (
    err.code === 'ECONNRESET' ||
    !socket.writable ||
    (responseInFlight && responseInFlight._headerSent) ||
    unfinishedMessage
  ) {
    socket.destroy();
    return;
  }

  logRejectedRequest(err.rawPacket);
  sendRawNotFound(socket);
}

// The server's 'connect' listener: Node diverts CONNECT to this event rather than the request
// listener, so the request gets the same log line and 404 contract as any other method.
function handleDivertedRequest(req, socket) {
  logRequest(req.method, pathForLog(req.url));

  sendRawNotFound(socket);
}

function resolvePort(rawPort) {
  if (rawPort === undefined || rawPort === '') {
    return DEFAULT_PORT;
  }

  // Digits only, which is what rejects `3000abc`, `3000.5` and `1e3` — forms a numeric
  // coercion would otherwise accept — as well as `abc` itself.
  if (!/^\d+$/.test(rawPort)) {
    return null;
  }

  const port = Number(rawPort);

  if (port < MIN_PORT || port > MAX_PORT) {
    return null;
  }

  return port;
}

function logConfigError(rawValue) {
  console.error(
    `Invalid PORT value "${rawValue}": expected an integer between ${MIN_PORT} and ${MAX_PORT}; ` +
      `leave PORT unset to use the default ${DEFAULT_PORT}.`,
  );
  process.exitCode = 1;
}

function handleServerError(err, port) {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Cannot start server: port ${port} is already in use. Free the port or start the server with a different PORT.`,
    );
  } else {
    console.error(
      `Cannot start server: ${err.message}. Check that the port is available and that the process has permission to bind it.`,
    );
  }

  process.exitCode = 1;
}

function handleShutdownSignal() {
  process.stdout.write(`Shutting down server on port ${activePort}\n`);

  // closeIdleConnections() arrived in Node 18.2.0, so the guard keeps this runnable on the
  // declared floor of 18.0.0, where the call is simply skipped.
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }

  server.close(() => process.exit(0));
}

function startServer(port) {
  activePort = port;
  server = http.createServer(handleRequest);

  server.on('error', (err) => handleServerError(err, port));

  server.on('listening', () => {
    process.stdout.write(`Server listening on port ${port}\n`);
  });

  // A request the HTTP parser rejects, and a CONNECT Node diverts to its own event, reach neither
  // handleRequest nor Node's default handling, so both get their log line and 404 from these.
  server.on('clientError', handleClientError);
  server.on('connect', handleDivertedRequest);

  process.on('SIGINT', handleShutdownSignal);

  server.listen(port);
}

const port = resolvePort(process.env.PORT);

if (port === null) {
  logConfigError(process.env.PORT);
} else {
  startServer(port);
}
