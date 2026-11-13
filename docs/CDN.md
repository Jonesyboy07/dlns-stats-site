# Python CDN

The CDN is a separate, read-only Flask/Waitress process behind nginx. The main
website writes uploads and synchronizes its assets to the **same filesystem**.
It is not a distributed edge network. Keep the existing CDN available while
testing; this repository cannot configure or restart your server remotely.

## How the system works

### The pieces

| Component | Responsibility |
| --- | --- |
| Main website | Renders pages, looks up the current asset manifest, and handles authenticated uploads. |
| Asset synchronizer | Runs alongside the main website when enabled. Publishes hashed copies of local site assets and updates their manifest. |
| Shared CDN folder | Stores the published copies, the manifest, existing CDN files and uploads. The website and CDN must access the same folder. |
| Python CDN | Runs separately on `127.0.0.1:5051`; reads the shared folder and serves files and manifests. |
| nginx | Terminates HTTPS and proxies CDN requests to Python. The example configuration can also cache versioned responses. |
| Browser | Loads the HTML from the website, then requests the asset URLs in that HTML or the React application. It may cache versioned assets. |

```text
Website source files --sync--> shared CDN folder <--read-- Python CDN <-- nginx <-- browser
                                     ^                        ^
                                     |                        |
                              owner upload           website requests manifest
```

The Python CDN is the origin service, not a geographically distributed CDN.
An external cache such as Cloudflare is optional and must be configured
separately. Restarting the CDN does not restart the website, and vice versa.

### 1. Starting and publishing assets

1. Configure both CDN URLs and `CDN_ROOT` in `.env`, then start the CDN and
   main website using their respective scripts. Either service can be
   restarted independently.
2. The main website startup script builds the frontend according to its usual
   startup workflow. When both CDN URLs are set, it runs an initial asset sync
   before starting the website, then starts a watcher that repeats the sync
   roughly every five seconds. The interval is measured after each sync
   completes, so large syncs take longer.
3. The sync reads CSS, fonts and images under `static/` and `public/`, plus
   the built `public/react-app/assets/App.css` if present. Where the same
   relative asset exists in both trees, the `public/` copy takes precedence.
   The original website files are **not renamed or removed**.
4. Each published copy is named with the full SHA-256 hash of its contents.
   For example, `css/styles.css` becomes
   `__site_assets/css/styles.<full-sha256>.css` in the CDN folder. The hash
   shown here is a placeholder for 64 hexadecimal characters.
5. Fonts and images are published before CSS. Recognized CSS `url(...)`
   references to those local assets are rewritten to their published paths;
   the rewritten CSS is then hashed. An image or font change can therefore
   produce a new CSS filename as well. External URLs, unknown paths and
   other references are left as they are.
6. After publishing, the sync atomically updates
   `.site-assets-manifest.json` in the CDN root. It maps original site paths
   to their current hashed paths. The old unversioned copies of currently
   managed assets in `__site_assets/` are removed, while previously published
   hashed versions are retained.

The [hash scripts](../scripts/) can run a one-off sync or a watcher manually.
Do not run an additional watcher alongside the one managed by the site.
Existing CDN files outside `__site_assets/` are not renamed or deleted.
The sync does not automatically publish JavaScript or HTML. Files that exist
only in the CDN, rather than in the website asset folders, are not brought
into the site asset manifest.

### 2. Loading a page

1. A visitor requests a page from the **main website**. During rendering, the
   website requests `GET /__cdn/site-assets` from `CDN_MANIFEST_BASE_URL`,
   normally the loopback CDN address. This is a server-to-server request, not
   a browser polling the manifest.
2. The CDN returns the current mapping with `Cache-Control: no-store`. The
   website reuses the result within that request and constructs public asset
   URLs using `CDN_PUBLIC_BASE_URL`.
3. The rendered page includes the current hashed CSS and font URLs and passes
   the image mapping to React. Supported image helpers use the mapping when a
   local published image exists; other images retain their existing CDN URLs.
   A separately configured team-logo host is respected.
4. The browser requests those URLs from nginx. nginx may serve a cached
   response or proxy the request to Python, which reads the shared folder.

The website obtains the mapping again on a subsequent page render; it does
not continuously push asset changes into an already open page. An existing
page can keep using its old hashed URLs, which remain available in the CDN
folder. A reload or later page render obtains the new mapping.

### 3. What happens when a file changes

For example, after a stylesheet is edited or the frontend is rebuilt:

1. The next sync sees the new bytes and publishes a filename containing their
   new SHA-256 hash.
2. The manifest is updated to point the original stylesheet path to that new
   filename.
3. The next page render receives the new filename, so the browser requests a
   **different URL** instead of reusing its cached old stylesheet.
4. The previous hashed file remains on disk for existing pages. Its cached
   response can still be reused; the system does not purge it automatically.

Hashed site files and valid `?v=<full-sha256>` file requests receive
`public, max-age=31536000, immutable` after the origin verifies the hash.
Unversioned files instead receive `public, no-cache`, allowing storage but
requiring revalidation; ETag and Last-Modified support conditional requests.
The generic manifest and site manifest are not cacheable, and errors use
`no-store`. The example nginx cache caches eligible versioned URLs; it does
not cache the manifests or ordinary unversioned URLs.

The publisher does not automatically clean up old hashed files. Plan backups
and monitor disk usage. Do not remove historical versions without accounting
for old pages and external references that may still use them.

### 4. Owner uploads are a separate flow

An owner or co-owner signs into the website with Discord and uses
`/admin/cdn/`. The website validates the upload and writes it to the shared
CDN folder; the public Python CDN only reads and serves it. The page returns
a URL such as `https://cdn.example/images/example.png?v=<full-sha256>`.

These uploads **do not** become hash-named site assets and are not added to
the site asset manifest. Replacing an upload changes its hash and the newly
returned URL. Unlike published site assets, the origin does not keep an old
copy of a replaced upload: an old query-versioned URL may be served by an
intermediary cache, but otherwise returns 404 at the origin. Existing
unversioned upload URLs still work and revalidate.

### 5. Failures and fallback

| Situation | What happens |
| --- | --- |
| Both CDN URL settings are blank | Main startup skips the sync; pages use their existing local CSS and image URL behavior. |
| Only one CDN URL is configured | Main startup fails with an explicit configuration error. |
| Initial sync fails, or the sync watcher exits | The main site runner exits rather than silently continuing; a supervisor can report or restart it. |
| CDN manifest cannot be fetched during rendering | The website logs a warning, uses local stylesheet/font URLs, and falls back to existing image URL behavior. Those existing image URLs may themselves point at the CDN. |
| A CDN stylesheet fails in the browser | The stylesheet link falls back to the corresponding local website URL. |
| CDN process is down | nginx cannot proxy uncached files; previously cached versioned responses may still be available depending on cache configuration. Restart the CDN independently. |
| Old unversioned managed assets are removed during migration | An already open page using those old `__site_assets/` paths may need a reload. Old hashed assets and files outside the managed directory are not removed by the sync. |

The fallback does not make every image available locally: CDN-only files and
custom external asset hosts remain dependent on their respective services.

## Configure

In the website's real `.env`, set:

```dotenv
CDN_ROOT=/srv/filebrowser/files/FileShare/CDN
CDN_PUBLIC_BASE_URL=https://cdn.dlns-stats.co.uk
CDN_MANIFEST_BASE_URL=http://127.0.0.1:5051
CDN_UPLOAD_MAX_BYTES=52428800
```

The root must already exist and be readable by the CDN process and writable by
the website and sync process. Choose appropriate directory ownership, ACLs and
group access; uploaded and synced files are world-readable (0644). Protect the
`.env` itself. The CDN process and website must start from the project root and
load the same `.env`. Leave both URL settings empty to leave site CSS on the
website while setting up. `IMAGE_CDN_BASE` is independent and is not changed.
Set the main site's reverse proxy and `TRUSTED_PROXIES` correctly so that
`request.host_url` reflects its public HTTPS origin; upload requests require a
matching `Origin` header. Set the main site's nginx `client_max_body_size`
slightly above `CDN_UPLOAD_MAX_BYTES` to allow for multipart overhead.

## Run and synchronize

After installing `backend/requirements.txt` and building the frontend, start
the CDN independently:

```bash
bash scripts/start_cdn.sh
```

On Windows use `scripts\start_cdn.bat`. Both use `PYTHON_EXE` when supplied,
otherwise prefer a local virtual environment and then system Python.
The CDN script runs in the foreground; supervise it in production. For systemd,
adapt [dlns-cdn.service](dlns-cdn.service), copy it to `/etc/systemd/system/`,
then run `sudo systemctl daemon-reload` and
`sudo systemctl enable --now dlns-cdn.service`. Check `systemctl status dlns-cdn`
and `journalctl -u dlns-cdn`. Adjust the unit's working directory, user and
Python environment. The main website service is configured separately.

The main website startup scripts publish assets before starting Waitress, then
run a watcher every five seconds when both CDN URL settings are configured.
The watcher runs with the site, not the CDN: restarting either service does not
restart the other. If synchronization fails, the site process exits so its
supervisor can report/restart it. If CDN URLs are blank, synchronization is
disabled and normal local site startup is unchanged. Set both URLs or neither.

You can publish manually (or supply `--watch`) using:

```bash
bash scripts/hash_cdn_assets.sh
```

On Windows use `scripts\hash_cdn_assets.bat`. These scripts use the shared
`CDN_ROOT` and leave local files unchanged. They publish site CSS, fonts, and
images as `__site_assets/.../name.<full-sha256>.ext` and atomically update a
manifest. CSS references to known local fonts and images are rewritten to their
hashed CDN paths. Website templates and image helpers use the current manifest;
custom team-logo hosts and CDN-only images retain their existing URLs. Vite
JavaScript and other non-image assets are not migrated. The sync removes
unversioned copies of *currently managed site assets* in `__site_assets/`, but
does not touch existing CDN files outside that reserved directory. Old hashed
versions are retained; monitor disk usage and back up the tree. Do not edit
the reserved namespace or run multiple independent sync watchers concurrently.

The site requests the no-store manifest once per page render. If it is
unavailable, it logs a warning and uses local CSS and existing image URLs;
if a CSS download fails, the browser falls back to local CSS. CDN-only images
and external links are not rewritten. Existing open pages using the older
unversioned `__site_assets/` URLs can break when those managed copies are
removed; reload them after deployment. Keep CDN URL settings blank until the
CDN service and initial sync are ready.

## nginx and verification

Use [cdn-nginx.conf](cdn-nginx.conf) as a starting point, adapting host, TLS,
cache directory and upstream. Its `map` and `proxy_cache_path` directives must
be loaded in the `http` context. Do not retain the old competing server block.
Check with `sudo nginx -t`, then reload nginx. The optional nginx cache only
caches hash-versioned URLs and includes the query string in its key. Configure
any Cloudflare/other edge cache to include the `v` query parameter in its cache
key, respect origin cache headers, and never cache the manifest or errors.
Update an existing proxy to use the new filename-aware cache map; the old
query-only map will serve hashed paths but will not cache them in nginx.

```bash
curl -i 'https://cdn.dlns-stats.co.uk/__cdn/site-assets'
```

The site manifest maps original paths to current hashed CDN paths. Hashed
site files receive one-year `immutable` caching only when their filename hash
matches their contents. Historical versions remain available on the origin.
The original generic manifest still accepts one to 32 repeated `path` query parameters and returns
`{"files":{"path":"sha256..."}}` with `no-store`. Append the complete hash as
`?v=<hash>` to obtain a URL with one-year `immutable` caching. A stale or
malformed hash returns a non-cacheable 404, never current bytes under the old
hash. Unversioned URLs continue to work but use `no-cache` with ETag and
Last-Modified revalidation. File responses support HEAD and range requests.
The service hashes and snapshots each origin response to ensure a versioned
response contains the bytes named by its hash; nginx caching reduces repeated
origin work. Ensure sufficient temporary disk space for concurrent downloads.

An already cached response from the old nginx configuration cannot be
retroactively invalidated: purge upstream caches if possible, otherwise wait
for their previous 30-day expiry. External clients must request the manifest
again to discover a changed hash. Old query-versioned upload URLs may continue to work in intermediary caches,
but the origin does not retain historical versions of replaced uploads.

## Uploads and security

Discord-authenticated `DISCORD_OWNER_ID` and `DISCORD_CO_OWNER_ID` users can
open `/admin/cdn/` from the admin hub, select a folder and file, and copy the
returned versioned URL. Replacement requires an explicit checkbox and browser
confirmation; uploads are written atomically. The size limit is per file.
Existing Filebrowser files remain available. No directory listing is public.
Uploads are disabled when the website is started with `run_debug.py --sandbox`,
so testing against a sandbox database cannot modify the live CDN.

The old nginx protections remain: hidden components, symlinks, and files ending
in `.env`, `.db`, `.sqlite`, `.sqlite3`, `.log`, `.bak`, `.backup`, `.ini`,
`.conf`, `.py`, `.sh`, `.pem`, or `.key` cannot be served or uploaded. Unlike
the old exception, `.well-known` is also blocked; handle ACME HTTP challenges
separately in nginx if required. The `__cdn/` and `__site_assets/` upload paths
are reserved. Other file types, including HTML, JavaScript and SVG, are allowed:
they may execute code in visitors' browsers. Only use trusted files and keep
secrets out of the public tree. Never expose the CDN service directly to the
internet or rely on it to protect against untrusted local filesystem writers.
