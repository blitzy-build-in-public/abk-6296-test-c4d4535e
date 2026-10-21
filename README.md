# nodejs-tutorial-hello-world

## Purpose

A minimal HTTP server that fits in one file and depends on nothing outside the Node.js
standard library. It answers `GET /hello` with `Hello world`, answers every other request
with `Not Found`, writes one log line per request, and shuts down cleanly on `CTRL+C`.

It is written for beginners learning the built-in `node:http` module, for instructors who
want a small reference example, and for developers who want to see a framework-free server
next to Express or Fastify.

The repository holds three files: `server.js` is the whole application, `package.json` is
the manifest, and this `README.md` is the tutorial. The manifest names the project
`nodejs-tutorial-hello-world` at version `1.0.0`, describes it as
`Minimal Node.js HTTP server tutorial demonstrating single endpoint implementation`,
declares the Node.js floor `>=18.0.0` in its `engines` field, and lists the keywords
`["nodejs","tutorial","http","server","beginner"]`.

## Prerequisites

- Node.js `>=18.0.0`
- `curl`, to send the requests shown below

Check your Node.js version:

```bash
node --version
```

There is no framework, no build step, and no package to install.

## Installation

Nothing to install. The server imports only Node.js built-ins, so the project has zero
dependencies: running `npm install` installs no packages, and `npm ls --all` reports an
empty tree. Some npm versions write an untracked `package-lock.json` as a side effect of
that command — it is not part of this project, and you can delete it.

## Execution

Run either command from the repository root. The second runs the first through the `start`
script in `package.json`.

```bash
node server.js
```

```bash
npm start
```

The server prints its startup line and then stays in the foreground, serving requests until
you stop it.

## Testing with curl

With the server running, send a request from a second terminal:

```bash
curl http://localhost:3000/hello
```

That prints `Hello world`. Add `-i` to see the status line and headers too:

```bash
curl -i http://localhost:3000/hello
```

A request that matches nothing is answered with the 404:

```bash
curl -i http://localhost:3000/invalid
```

## Expected output

The startup line, written to stdout:

```text
Server listening on port 3000
```

The response to `curl -i http://localhost:3000/hello`:

```text
HTTP/1.1 200 OK
Content-Type: text/plain
Date: Tue, 20 Oct 2026 17:15:54 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 11

Hello world
```

The response to `curl -i http://localhost:3000/invalid`:

```text
HTTP/1.1 404 Not Found
Content-Type: text/plain
Date: Tue, 20 Oct 2026 17:15:54 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 9

Not Found
```

`Date` and `Keep-Alive` carry values that change between responses and between machines; the
other lines are fixed.

Each request also writes one line to stdout in the format
`[<ISO-8601 timestamp>] [<HTTP method>] [<request path>]`, for example:

```text
[2026-10-20T17:15:20.877Z] [GET] [/hello]
```

The timestamp and the path describe the request that arrived. The path is the resolved
pathname, so the query string and any fragment are already removed.

## Shutdown

Press `CTRL+C` in the terminal running the server, or send the same signal to the process
with `kill -s INT <pid>`. The server prints its shutdown line, closes its connections
cleanly, and exits with status `0`.

```text
Shutting down server on port 3000
```

## PORT configuration

The port comes from the `PORT` environment variable and defaults to `3000` when `PORT` is
unset or empty. Accepted values are digits only and must be an integer between `1024` and
`65535`.

```bash
PORT=8080 node server.js
```

```text
Server listening on port 8080
```

Any other value is rejected before a socket is created: the message below is written to
stderr, nothing is written to stdout, and the process exits with status `1`.

```bash
PORT=abc node server.js
```

```text
Invalid PORT value "abc": expected an integer between 1024 and 65535; leave PORT unset to use the default 3000.
```

The digits-only rule is why `3000.5`, `3000abc` and `1e3` are rejected as well, even though a
numeric coercion would read something into them. Ports below `1024` — `80` and `1023`, for
instance — are refused with the same message, because the range rule is unconditional and no
option exists to bind a privileged port.

Startup also fails, with a different message, when the port itself cannot be bound — when
another process already holds it, for instance. The server binds nothing: the message below
is written to stderr, nothing is written to stdout, and the process exits with status `1`.
The port the message names is the port that could not be bound.

```text
Cannot start server: port 3000 is already in use. Free the port or start the server with a different PORT.
```

A bind that fails for any other reason — a permission error, for example — is reported the
same way, with the operating system's own error message in place of the port-in-use sentence:
`Cannot start server: <reason>. Check that the port is available and that the process has permission to bind it.`
Neither message is accompanied by a stack trace.

## Routing

A request matches only when its method is `GET` and its path is `/hello`. The path compared
is the one the request target resolves to as a URL relative to the base `http://localhost`,
so the query string and any fragment are dropped before the comparison. The comparison
itself is exact and case-sensitive: neither trailing slashes nor case are normalised.

| Request | Response | Why |
| --- | --- | --- |
| `GET /hello` | `200 Hello world` | The one route |
| `GET /hello?a=1` | `200 Hello world` | The query string is discarded by resolution |
| `GET /hello/` | `404 Not Found` | No trailing-slash normalisation |
| `GET /HELLO` | `404 Not Found` | Matching is case-sensitive |
| `POST /hello` | `404 Not Found` | The method is part of the match |
| any other method or path | `404 Not Found` | One shared catch-all |

A target that cannot be parsed is answered with the same `404`. A request whose path matches
but whose method does not is answered with `404` and no `Allow` header, rather than with
`405`.
