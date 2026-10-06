# Smart Crop Disease Detection Platform

Responsive crop-leaf image uploads, TensorFlow/Keras-ready diagnosis, and persistent SQLite detection history for farmers.

## Run & Operate

- `pnpm --filter @workspace/crop-disease-platform run dev` — run the React web app
- `uv run --project . python artifacts/crop-disease-platform/server/app.py` — run the Flask REST API (port 8080 in its managed workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- SQLite data is stored in `artifacts/crop-disease-platform/data/detections.sqlite`; uploaded images are stored under `artifacts/crop-disease-platform/uploads/`.
- Trained weights are optional. See `artifacts/crop-disease-platform/models/README.md`.

## Stack

- pnpm workspace; React, Vite, Tailwind CSS, TypeScript
- Flask REST API; SQLite via Python's standard library
- OpenAPI contract and generated typed React Query hooks
- Optional TensorFlow/Keras image inference adapter

## Where things live

- `artifacts/crop-disease-platform/src/` — React pages and application shell
- `artifacts/crop-disease-platform/server/` — Flask routes and Keras model adapter
- `artifacts/crop-disease-platform/models/README.md` — model setup and preprocessing contract
- `lib/api-spec/openapi.yaml` — API source of truth
- `artifacts/api-server/.replit-artifact/artifact.toml` — managed `/api` service runs the Flask API

## Architecture decisions

- Follow the requested Flask + SQLite stack while retaining the workspace's shared `/api` service path.
- Detection records with missing model weights are stored as `model_unavailable`; no diagnosis is fabricated.
- Image data is stored as files, while SQLite stores image paths and searchable detection metadata.

## Product

Home, Disease Detection, Results, Dashboard, Detection History, and About pages. Uploads, model readiness, saved results, history search/filter/delete, and activity summaries use the Flask API.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- A trained `.keras` file and ordered `models/class_names.json` must both exist before inference is enabled.
- After changing the OpenAPI contract, rerun `pnpm --filter @workspace/api-spec run codegen`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
