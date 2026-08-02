# CTrack Engine API

Base URL (default): `http://127.0.0.1:7777`

- Service name: `ctrack-engine`
- Engine version: `0.1.0`
- Content type: `application/json` (except SSE stream)

## Localhost-only guard

Some write/setup routes are protected by `localhostSetupOnly` and return `403` if the caller is not local (`127.0.0.1` / `::1`).

## HTTP routes

### `GET /health`
Returns health and runtime metadata.

Response:
- `status: "ok"`
- `service: string`
- `version: string`
- `pythonReady: boolean`
- `platform: string`
- `engineRoot: string`
- `setupComplete: boolean`

### `GET /api`
Discovery endpoint listing public HTTP routes plus service/version metadata.

Response:
- `service: string`
- `version: string`
- `routes: Array<{ method: string; path: string; localhostOnly?: boolean }>`

### `GET /api/setup/status`
Returns setup completion state and user env file path.

Response:
- `complete: boolean`
- `userEnvPath: string`

### `GET /api/setup/runtime-config`
Returns runtime frontend config values.

Response:
- `supabaseUrl: string`
- `supabaseAnonKey: string`

### `POST /api/setup/save` (localhost only)
Merges posted key/value pairs into the user env file.

Body:
```json
{
  "KEY": "value"
}
```

Response:
```json
{
  "ok": true,
  "complete": true
}
```

### `GET /api/engine/status`
Returns tool/runtime status from Python manager.

Response:
```json
{
  "ok": true
}
```
Additional status fields are included from runtime status fetch.

### `POST /api/engine/rescan` (localhost only)
Forces a tool rescan and returns refreshed status.

Response:
```json
{
  "ok": true
}
```
Additional status fields are included from runtime status fetch.

### `GET /api/engine/settings`
Returns current merged engine + tray settings bundle.

Response:
```json
{
  "ok": true
}
```
Additional settings fields are included from the settings bundle.

### `PATCH /api/engine/settings` (localhost only)
Patches engine and/or tray settings.

Body:
```json
{
  "engine": {},
  "tray": {}
}
```

Response:
```json
{
  "ok": true
}
```
Additional settings fields are included from the updated settings bundle.

### `POST /api/gui/open` (localhost only)
Opens Python settings GUI on Windows.

Body:
```json
{
  "panel": "settings"
}
```
or
```json
{
  "panel": "tray"
}
```

Behavior:
- `panel: "settings"` -> launches `scripts/open-tray-settings.vbs` with `wscript.exe`
- `panel: "tray"` -> launches `pythonw -m gui.settings_window --install-root <root>`

Response:
```json
{
  "ok": true,
  "panel": "settings",
  "launcher": "open-tray-settings.vbs"
}
```

### `POST /api/publish/enqueue` (localhost only)
Enqueues a publish job for Nuke or external clients.

Body:
```json
{
  "file_path": "D:/shots/AA_010_comp.1001.exr",
  "project_id": "optional-project-id",
  "shot_id": "optional-shot-id",
  "shot_code": "optional-shot-code",
  "task_id": "optional-task-id",
  "task_name": "optional-task-name",
  "tracking_number": "optional-tracking-number",
  "meta": { "tab": "version" },
  "auto_process": false
}
```

Response:
```json
{
  "ok": true,
  "job": {}
}
```
If `auto_process` is `true`, the route processes the job immediately and also returns:
- `processed: true`
- `output_path: string`

### `GET /api/publish/jobs`
Lists publish jobs from the queue database.

Query params:
- `limit` (optional, default `200`, max `1000`)

Response:
```json
{
  "ok": true,
  "jobs": []
}
```

### `GET /api/publish/jobs/:id`
Returns one publish job and its event log.

Response:
```json
{
  "ok": true,
  "job": {},
  "logs": []
}
```

### `POST /api/publish/jobs/:id/process` (localhost only)
Runs headless processing for one queued job (minimal v1 path: transcode to review MP4 and mark completed).

Response:
```json
{
  "ok": true,
  "job": {},
  "output_path": "C:/Users/.../AppData/Local/Temp/ctrack-publish-review/..."
}
```

### `POST /api/publish/process-next` (localhost only)
Processes the next idle job in FIFO order.

Response when a job is processed:
```json
{
  "ok": true,
  "processed": true,
  "job": {},
  "output_path": "..."
}
```

Response when no idle jobs exist:
```json
{
  "ok": true,
  "processed": false,
  "message": "No idle jobs available"
}
```

### `GET /api/stream`
Server-Sent Events endpoint.

SSE events:
- `connected`
- `ping`
- `python-log`
- `upload-progress`
- `queue-log`

### `POST /api/ipc`
Generic IPC bridge endpoint for frontend-engine actions.

Body:
```json
{
  "channel": "string",
  "payload": {}
}
```

Response:
- Returns channel-specific payload.
- Returns `400` for invalid channel input.
- Returns `500` for unknown channel or handler errors.

## IPC channels exposed by `POST /api/ipc`

### Publish-related
- `upload-s3`
- `video-metadata`
- `open-external-url`

### Queue-related
- `queue:get-jobs`
- `queue:add-job`
- `queue:update-job`
- `queue:remove-job`
- `queue:clear`
- `queue:purge`
- `queue:add-log`
- `queue:add-event`
- `queue:get-logs`
- `queue:get-events`

### Publish REST routes
- `POST /api/publish/enqueue`
- `GET /api/publish/jobs`
- `GET /api/publish/jobs/:id`
- `POST /api/publish/jobs/:id/process`
- `POST /api/publish/process-next`

### Engine/setup/runtime
- `python-command`
- `python:install-deps`
- `select-directory`
- `dialog:open-files`
- `dialog:open-folder-files`
- `staging:read`
- `staging:write`
- `staging:clear`
- `staging:process-files`
- `staging:process-paths-or-folders`
- `settings:read`
- `settings:write`
- `app:get-temp-path`
- `app:ensure-dir`
- `fs:delete-file`
- `notify`
- `auth:get-pending-code`
- `engine:get-status`
- `engine:rescan-tools`
