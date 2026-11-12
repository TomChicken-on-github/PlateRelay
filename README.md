# PlateRelay

[简体中文](README.zh-CN.md)

A self-hosted management system for shared 3D printers. It takes print requests from many people, queues them across a pool of printers, and keeps track of every finished part until its owner collects it.

It is built for places where printers are a shared resource: hackathons, makerspaces, schools and studios.

## About The Project

Shared printers usually run on chat messages and sticky notes: who is next, which printer is free, where the finished part went. PlateRelay puts that in one system and treats the physical handoff as part of it, not an afterthought.

### Features

* **Order intake**: accepts sliced `.gcode.3mf` files and reads the plates, filaments and print time from them. A multi-plate file becomes one independent order per plate.
* **Review and queue**: staff approve or reject requests; approved orders wait in a first-come, first-served queue and are only matched with printers that can actually print them.
* **Printer management**: shows each printer's real state, as reported by the printer itself, and dispatches jobs after a person on site confirms the filament mapping.
* **Custody handoff**: when a print finishes, the person who clears the plate records the part with a photo and a shelf slot; the owner then collects it with a one-time code that staff scan.
* **Roles and audit**: four preset roles (User, Staff, Builder, Coreteam) built on fine-grained permissions, and an append-only audit log.
* **Self-hosted and pluggable**: runs on your own hardware; printer brands are adapters, and object storage is any S3-compatible service or local disk.

The system has three parts:

| Part | Where | Role |
| --- | --- | --- |
| Panel server | `apps/server` | Orders, queue, permissions, audit, storage |
| Panel web UI | `apps/web` | The browser interface |
| Daemon | `daemon` | Runs inside the printers' LAN, connects out to the panel, and talks to the printers |

The daemon connects outward to the panel, so the printers do not need to be reachable from the internet. Printer access codes are encrypted in the browser with the daemon's public key; the panel stores only ciphertext.

### Built With

* [NestJS](https://nestjs.com/) and PostgreSQL ([Drizzle ORM](https://orm.drizzle.team/)); an embedded PGlite is used for development
* [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/), [Motion](https://motion.dev/)
* Python 3.12+ for the daemon
* S3-compatible object storage (local disk by default)
* An OpenAPI contract and JSON-schema daemon protocol in `packages/shared/schema`, from which the types are generated

## Getting Started

The steps below run the whole system on one machine with a simulated printer. Nothing touches a real printer.

### Prerequisites

* Node.js 24 or newer and [pnpm](https://pnpm.io/)
* [uv](https://docs.astral.sh/uv/) for the Python daemon

### Installation

```sh
git clone https://github.com/TomChicken-on-github/PlateRelay.git
cd PlateRelay
pnpm install
(cd daemon && uv sync)
```

### Run the panel, a simulated printer and the daemon

Use three terminals.

```sh
# 1. Panel server on :3000 (embedded database, data in .platerelay-data/)
PLATERELAY_DEV_ENROLL_TOKEN=devtoken pnpm dev:server
```

```sh
# 2. A simulated printer on 127.0.0.1:7130
cd daemon
PYTHONPATH=src uv run python -m platerelay_sim run --count 1 --speed 60
```

```sh
# 3. The daemon; the token is only needed on the first run
cd daemon
PLATERELAY_ENROLL_TOKEN=devtoken PLATERELAY_DEV_INSECURE=1 \
  PYTHONPATH=src uv run python -m platerelay_daemon --data-dir ./.daemon-data run --panel http://localhost:3000
```

Then create the first administrator and add the printer through the API (see [apps/server/README.md](apps/server/README.md)): call `POST /api/v1/setup` once, or run `pnpm --filter @platerelay/server user:create`. Add a printer with brand `sim`, serial `SIM-0001` and host `127.0.0.1:7130`. After its first report the printer waits in "clearing required" until someone confirms the plate is clear.

### Run the web UI prototype

```sh
pnpm dev:web
```

Open http://localhost:5173/. This runs on local mock data and needs no server or daemon. It is not yet connected to the rewritten server API.

## Usage

* Server configuration, environment variables, the HTTP conventions and the module layout: [apps/server/README.md](apps/server/README.md)
* Daemon, simulated printer and how to drive it as the person standing next to the machine: [daemon/README.md](daemon/README.md)
* Web UI: [apps/web/README.md](apps/web/README.md)
* The API contract: [packages/shared/schema/openapi.yaml](packages/shared/schema/openapi.yaml)

Tests:

```sh
pnpm test                      # shared contract and server
(cd daemon && uv run pytest)   # daemon
```

## Roadmap

Done:

- [x] Order, review, queue, dispatch, store and pickup flow on the server, with permissions and audit log
- [x] Daemon with a simulated printer, exercised end to end against the server
- [x] Contract-first API and daemon protocol with generated types
- [x] Web UI prototype

In progress or planned:

- [ ] Web UI on the new API
- [ ] Bambu Lab printer adapter (read-only status mapping exists; commands to real printers are not implemented)
- [ ] Camera live view, snapshots and time-lapse
- [ ] Upload safety checks beyond file readability
- [ ] Notifications, invite codes, OIDC sign-in
- [ ] LAN printer discovery

Open an issue to suggest more.

## Contributing

Contributions are welcome.

1. Fork the project and create a branch
2. Make your change and run the tests above
3. Open a pull request against `main`

Generated files under `packages/shared/src/generated` and `daemon/src/platerelay_daemon/protocol` come from the schema: edit the schema, then run `pnpm --filter @platerelay/shared generate` and `daemon/scripts/generate_protocol.sh`.

## License

Distributed under the GPL-3.0-only license. See [LICENSE](LICENSE).

Third-party code is listed in [Third-party code](#third-party-code).

## Acknowledgments

* [ha-bambulab](https://github.com/greghesp/ha-bambulab): the Bambu Lab adapter reuses its `pybambu` library
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)

### Third-party code

| Component | Location | Copyright | License |
| --- | --- | --- | --- |
| [ha-bambulab](https://github.com/greghesp/ha-bambulab) `pybambu` | [daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/](daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/) | Copyright (c) 2023 ha-bambulab contributors | MIT, see [LICENSE](daemon/src/platerelay_daemon/adapters/bambu/_vendor/pybambu/LICENSE) |

Copyright (C) 2026 Tom_Chicken. PlateRelay is not affiliated with Bambu Lab or the ha-bambulab project.
