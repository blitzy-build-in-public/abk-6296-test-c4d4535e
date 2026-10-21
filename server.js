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

function requestPath(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    // A target the URL constructor rejects, such as `http://[`, falls back to the raw
    // target so the request is answered with the 404 instead of crashing the process.
    return req.url;
  }
}

function logRequest(method, path) {
  process.stdout.write(`[${new Date().toISOString()}] [${method}] [${path}]\n`);
}

function handleRequest(req, res) {
  const path = requestPath(req);

  // The log line's path field carries no query string or fragment, so the raw target the
  // parse-failure fallback returns is cut at its first `?` or `#`; routing still uses `path`.
  logRequest(req.method, path.split(/[?#]/)[0]);

  if (req.method === 'GET' && path === HELLO_PATH) {
    handleHelloRequest(req, res);
  } else {
    handleNotFoundRequest(req, res);
  }
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

  process.on('SIGINT', handleShutdownSignal);

  server.listen(port);
}

const port = resolvePort(process.env.PORT);

if (port === null) {
  logConfigError(process.env.PORT);
} else {
  startServer(port);
}
