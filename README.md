# AI UGC Creator Database

Local web app + MCP server for cataloguing AI personas — bios, voice, social handles, image libraries, relationships, family trees, photos-together, and physical-attribute anchors for consistent image generation.

Designed to plug into Claude (web / desktop / code) as an MCP connector so writing and content-planning skills can pull rich, structured persona context on demand.

## Architecture

```
                                      ┌──────────────────────┐
  ugc.<your-domain>  ──┐               │       Claude         │
                       │   Cloudflare  │  (web/desktop/code)  │
  mcp.<your-domain>  ──┤    Tunnel     └──────────┬───────────┘
                       │   (optional)              │ MCP protocol
                       ▼                           │
┌──────────────────────────────────────────────────┴─────────┐
│  Local Docker stack                                         │
│                                                             │
│  ┌──────────────┐  ┌────────┐  ┌────────┐  ┌──────────┐    │
│  │ cloudflared  │─▶│  api   │  │  mcp   │  │   db     │    │
│  │  (profile)   │  │ :3000  │  │ :3100  │  │ postgres │    │
│  └──────────────┘─▶│ serves │  │ tools  │  └──────────┘    │
│                    │ /api + │  │ over   │                  │
│                    │ static │  │ HTTP   │                  │
│                    │ web    │  └────────┘                  │
│                    └────────┘                              │
└────────────────────────────────────────────────────────────┘
```

- **`api`** – Node 20 + Express. Serves the React frontend (`web/`) and the REST API (`/api/*`). Images stored as `bytea` in Postgres.
- **`mcp`** – Node 20 + Express + `@modelcontextprotocol/sdk`. Streamable HTTP transport at `POST /mcp`. Bearer-token auth.
- **`db`** – Postgres 16. Single source of truth for personas, families, relationships, images, plus a materialized `persona_neighborhood` view that auto-refreshes on mutations.
- **`cloudflared`** *(optional)* – Cloudflare Tunnel agent for exposing the stack via your domain without opening router ports. Only starts when you activate the `tunnel` Compose profile.

## Quick start (local)

```bash
cp .env.example .env       # optional — defaults work
docker compose up -d       # build + start db, api, mcp
open http://localhost:8080 # web UI
curl localhost:3100/health # MCP health probe
```

First run with an empty DB auto-seeds four sample personas (Maya, Aiko, Noah, Lina) plus one family (The Riveras) and one sample relationship. Clear them from the in-app hint bar.

To stop:

```bash
docker compose down            # stop, keep data
docker compose down -v         # stop + wipe Postgres volume
```

## Configuration (`.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `WEB_PORT` | `8080` | Host port for the browser UI + REST API |
| `MCP_PORT` | `3100` | Host port for the MCP server |
| `DB_PORT` | `5433` | Host port for Postgres (useful for SQL clients) |
| `POSTGRES_USER` / `PASSWORD` / `DB` | `ugc` | DB credentials |
| `MCP_TOKEN` | *(empty)* | Bearer token required by every MCP request. Empty = no auth (local LAN trust only — never expose without setting this). Generate with `openssl rand -hex 32`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | *(empty)* | Required only if you start the `tunnel` profile. See [Cloudflare Tunnel setup](#cloudflare-tunnel-setup) below. |

## Exposing to Claude via Cloudflare Tunnel

The MCP server has to be reachable from Claude. For Claude.ai (web) you need a public HTTPS endpoint. Cloudflare Tunnel handles that without opening router ports.

### One-time Cloudflare setup (~5 minutes)

1. Sign in to the [**Cloudflare Zero Trust dashboard**](https://one.dash.cloudflare.com/) and pick your account.
2. **Networks → Tunnels → Create a tunnel.** Choose `Cloudflared` as the connector type. Name it (e.g. `ugc-creator-db`).
3. Cloudflare shows an **install command containing the tunnel token** — copy just the token (the `eyJ…` string after `--token`). Paste into `.env`:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=eyJhI…
   ```
4. **Configure public hostnames** in the same flow:

   | Subdomain | Service | Notes |
   |---|---|---|
   | `ugc.<your-domain>` | `http://api:3000` | The web UI + REST API |
   | `mcp.<your-domain>` | `http://mcp:3100` | The MCP server |

5. *(Recommended)* For the `ugc.` hostname, add **Cloudflare Access** so only you can load it: **Access → Applications → Add an application → Self-hosted**, pick the hostname, add yourself as the only allowed user (email PIN is simplest). The `mcp.` hostname stays open since the bearer token protects it.

### Start the tunnel locally

```bash
# Set a strong MCP_TOKEN first
openssl rand -hex 32 | xargs -I {} sed -i.bak 's/^MCP_TOKEN=.*$/MCP_TOKEN={}/' .env

# Then bring up the tunnel
docker compose --profile tunnel up -d
docker compose logs -f cloudflared   # watch for "Registered tunnel connection"
```

Both URLs should now resolve over HTTPS:

```bash
curl https://ugc.<your-domain>/api/health
curl https://mcp.<your-domain>/health
```

### Connect Claude as an MCP connector

In Claude (web / desktop / code), add a custom MCP connector:

- **URL:** `https://mcp.<your-domain>/mcp`
- **Auth header:** `Authorization: Bearer <the MCP_TOKEN value>`

Claude will discover the 10 tools and you can use them from any skill.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_personas` | Compact cards of every persona — id, name, primary handle, status, niches, families |
| `list_families` | Family cards with lore preview + member count |
| `search(query)` | Free-text across bios, backstories, niches, handles, family lore |
| `resolve(identifier)` | Resolve a name, handle (e.g. `@maya.moves`), or family slug — returns persona/family info or an ambiguous-candidate list |
| `get_persona(identifier, samples?, inline_images?)` | Full persona prompt-bundle: identity, story, visual (style + **physical** + sampled prompts), social, 1-hop neighborhood. Reference photo embedded as base64. |
| `get_pair(a, b, samples?, inline_images?)` | Relationship prompt-bundle: both personas' summaries + full narrative (origin, dynamic, bonding moments, tensions, mutual influence, inside jokes, current arc, content seeds) + photos-together |
| `get_family(identifier, samples?, inline_images?)` | Family prompt-bundle: meta + lore + each member's summary + intra-family relationships |
| `get_family_of_persona(persona, family?, samples?, inline_images?)` | "Give me the family of `@maya.moves`" — auto-resolves if persona is in 1 family, asks via `family` param if in multiple |
| `get_neighborhood(persona, depth?)` | Lightweight graph subgraph N hops out from a persona |
| `get_relationship_between(a, b)` | Quick existence check — returns `{ exists: false }` or a compact record |

All tools return JSON-stringified data plus inlined reference photos (base64) where applicable.

## REST API surface

All under `/api`. See `api/server.js` for the full set; the highlights:

```
GET    /api/personas                          # list (with relationships summary)
GET    /api/personas/:idOrHandle              # full record — accepts UUID, @handle, name
PUT    /api/personas/:idOrHandle              # idempotent upsert
DELETE /api/personas/:idOrHandle
GET    /api/personas/:idOrHandle/prompt-bundle           # the bundle the MCP uses
GET    /api/personas/:idOrHandle/family-bundle           # family entered via persona
GET    /api/personas/:idOrHandle/neighborhood            # materialized-view read

GET    /api/families                          # list with member counts
GET    /api/families/:idOrHandle              # full record + members
PUT    /api/families/:idOrHandle              # upsert
DELETE /api/families/:idOrHandle
POST   /api/families/:idOrHandle/members
GET    /api/families/:idOrHandle/prompt-bundle

GET    /api/relationships                     # ?persona_id=, ?family_id=, ?category=, ?status=
GET    /api/relationships/:id
POST   /api/relationships                     # 409 on duplicate
PUT    /api/relationships/:id
DELETE /api/relationships/:id
POST   /api/relationships/:id/images          # multipart photo upload
GET    /api/relationships/:id/prompt-bundle

GET    /api/resolve/persona/:identifier       # → { id, name } or 409 ambiguous
GET    /api/resolve/family/:identifier

GET    /api/graph                             # full lightweight graph for the visualization
GET    /api/graph/neighborhood/:idOrHandle    # subgraph N hops out

POST   /api/images                            # multipart upload, returns { id }
GET    /api/images/:id                        # streams bytes with proper Content-Type

POST   /api/seed                              # idempotent — loads samples if none present
GET    /api/health
```

## Editing the frontend

`web/` is volume-mounted into the `api` container, so edits to `*.jsx` / `*.css` / `*.html` show up on a hard refresh — no rebuild needed. The frontend uses React + Babel from CDN (transpilation happens in the browser).

To pick up API or MCP code changes:

```bash
docker compose up -d --build api
docker compose up -d --build mcp
```

## Project layout

```
.
├── docker-compose.yml
├── .env / .env.example
├── db/
│   ├── init.sql
│   └── migrations/
│       ├── 001-relationships.sql
│       ├── 002-handles.sql
│       ├── 003-graph-queries.sql
│       └── 004-physical.sql
├── api/                       # Express: serves /api + static web/
│   ├── Dockerfile, package.json, server.js, samples.js
├── mcp/                       # Express + @modelcontextprotocol/sdk
│   ├── Dockerfile, package.json, server.js, tools.js
└── web/                       # React + Babel (CDN-loaded, no build step)
    ├── index.html, styles.css
    ├── db.js                  # REST client (window.DB)
    ├── rel-types.js           # type catalog (44 relationship types)
    ├── ui.jsx                 # primitives
    ├── form.jsx, detail.jsx          # persona CRUD
    ├── family-form.jsx, family-detail.jsx, families.jsx
    ├── relationship-form.jsx, relationship-detail.jsx
    ├── graph.jsx              # d3-force knowledge graph
    └── app.jsx                # shell + navigation
```

## Security notes

- This is intentionally a **personal local tool**. Social-account passwords are stored in **plain text** in Postgres (same trade-off as the original prototype).
- The REST API has no authentication of its own. Lock it down with Cloudflare Access if you expose `ugc.` via the tunnel.
- The MCP server is protected by a bearer token (`MCP_TOKEN`). **Set this before exposing publicly.** It defaults to empty for local-only convenience.
- Tunnel + bearer token + Access on the web UI is the recommended deployment for safe remote use.
