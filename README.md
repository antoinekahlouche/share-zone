# Share zone
A shared drop zone on your home network, accessible in Safari on Mac and iPhone.

Requires Bun. No packages to install.

```sh
cd ~/ws/share-zone
bun start
```

Open http://localhost:8080 on the host. On your iPhone or another Mac, use the Network URL printed in Terminal, connected to the same home network. Allow incoming connections if macOS asks. Keep the host awake.

Files are stored in `shared/` automatically. Optional configuration: `PORT=9090 bun start` or `SHARE_DIR=/absolute/path bun start`.

Everyone with access can upload, download, and permanently delete files. Existing filenames are rejected. Keep this on your trusted home network and do not forward its port on your router. Folder downloads require the `zip` command, included with macOS. Uploads are limited to 1 GiB per request.

Use `bun dev` to restart automatically while editing. Stop with Ctrl+C.

## Docker

Edit the host path on the left side of the volume in `compose.yaml`:

```yaml
volumes:
  - ./shared:/data
```

For example, use `/srv/documents:/data`. The container always stores shared files at `/data`. No environment file is needed.

```sh
docker compose up -d --build
```

The host folder must allow container UID 1000 to read, write, and delete files. Files persist when the container is replaced. Everyone who can reach the app can access and delete these files.

Open `http://YOUR_SERVER_IP:8080`. Stop any local server already using port 8080, or change the Compose port mapping to `8081:8080`.

## GitHub Container Registry

Publish this project as `antoinekahlouche/share-zone` on GitHub, with `main` as the default branch. Pushing to main runs `.github/workflows/publish.yml`, building Linux amd64 and arm64 images and publishing `ghcr.io/antoinekahlouche/share-zone:latest`. No registry secret is required: Actions uses GITHUB_TOKEN.

After the first successful build, set the GHCR package visibility to public to allow the server to pull without logging in. For a private package, authenticate Docker to GHCR with a token that has read:packages access.

The deployment is in `/Volumes/DOCKER/share-zone/compose.yaml`, included by the global Compose file. Persistent files stay in `/Volumes/DOCKER/share-zone/shared`.

Deploy or update after the image is published:

```sh
cd /Volumes/DOCKER
docker compose up -d share-zone
```

Open `http://YOUR_SERVER_IP:8081`. The project's own compose.yaml remains available for local image builds.
