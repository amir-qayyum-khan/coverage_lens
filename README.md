# shorts-factory-render

ffmpeg assembly API for Shorts Factory (Ken Burns stills, concat, captions, audio).

## Endpoints
- `GET /health` → `{ ok, ffmpeg }`
- `POST /render` → assemble mp4
- `GET /files/{fileId}` → download

## Deploy
Dockerfile uses exec-form CMD (no bash -c):
`CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]`

Optional env: `RENDER_SECRET`, `PORT` (default 8080).
