# Church Bulletin Builder application

Milestone 4 provides the offline desktop editor and no-code template-authoring UI.

## Run the desktop application

Requirements: Node.js 22 or newer, npm, and a supported Windows or Linux desktop.

```sh
cd app
npm install
npm start
```

The desktop app stores its durable bulletin library in the current user's private
application-data directory. To use a separate library during development or a
smoke test, set an absolute workspace location:

```sh
CBB_WORKSPACE_ROOT=/absolute/path/to/a/library npm start
```

The application works with networking disabled. Its sandboxed renderer has no
filesystem, process, credential, or network capability; local documents and
managed images cross the validated desktop bridge by identity, never by a path
provided by the UI.

A source checkout intentionally contains no native release signing material.
The desktop editor and durable bulletin library remain usable, while live PDF
preview reports itself as unavailable unless the build includes the separately
signed and pinned M3
native runtime bundle. The temporary browser demo below includes a local sample
PDF for exercising the preview controls. Partial or tampered native bundles stop
startup instead of falling back to tools from the host computer.

## Run the temporary browser demo

```sh
cd app
npm install
npm run demo
```

Open <http://127.0.0.1:5173/>. The browser demo exercises the same renderer UI and
includes a local sample PDF, but its bulletin library is intentionally in memory
and is discarded when the page reloads. Use `npm start` for durable work.

## Verify the application

```sh
npm run typecheck
npm test
npm run build
```

Linux hosts with Bubblewrap and the pinned native test prerequisites can also run
the M3 isolation acceptance suite with `npm run test:m3-native:linux`.
