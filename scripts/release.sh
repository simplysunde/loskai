#!/usr/bin/env bash
#
# release.sh — build Loskai's two images and push them, tagged with the version and `latest`.
#
#   make release VERSION=0.1.0                                  # to ghcr.io/simplysunde
#   make release VERSION=0.1.0 LOSKAI_REGISTRY=<host>/<owner>   # anywhere else, e.g. a Forgejo
#
# The images are what the compose files run: <registry>/loskai (the Dockerfile) and
# <registry>/loskai-caddy (caddy/Dockerfile), for amd64 and arm64 (a Raspberry Pi). Building
# for both needs QEMU for the one this machine isn't, set up once per boot:
#   docker run --privileged --rm tonistiigi/binfmt --install arm64
# and `docker login <registry>` with a token allowed to write packages.
#
# Refuses a tree with uncommitted changes, so an image is always a commit, and a version
# already tagged. Tags the commit v<VERSION> here; pushing the tag is yours to do.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
REGISTRY="${LOSKAI_REGISTRY:-ghcr.io/simplysunde}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER=loskai-release

die() { echo "release: $*" >&2; exit 1; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "give a version, e.g. make release VERSION=0.1.0"
[ -z "$(git status --porcelain)" ] || die "commit or stash first — an image is always a commit"
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && die "v$VERSION is already tagged"

# The default builder can't build for several platforms; a docker-container one can. Host
# networking lets it push to a registry on this machine too.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 \
	|| docker buildx create --name "$BUILDER" --driver docker-container --driver-opt network=host >/dev/null
docker buildx inspect "$BUILDER" --bootstrap >/dev/null
supported="$(docker buildx inspect "$BUILDER" | sed -n 's/^Platforms: *//p')"
for p in ${PLATFORMS//,/ }; do
	[[ ", $supported," == *", $p,"* ]] \
		|| die "this machine can't build $p — once per boot: docker run --privileged --rm tonistiigi/binfmt --install ${p#linux/}"
done

commit="$(git rev-parse --short HEAD)"
for image in loskai:. loskai-caddy:caddy; do
	name="${image%%:*}"
	context="${image#*:}"
	log "Building $REGISTRY/$name:$VERSION ($PLATFORMS) from $commit"
	docker buildx build --builder "$BUILDER" --platform "$PLATFORMS" \
		--label "org.opencontainers.image.version=$VERSION" \
		--label "org.opencontainers.image.revision=$commit" \
		--tag "$REGISTRY/$name:$VERSION" --tag "$REGISTRY/$name:latest" \
		--push "$context"
done

git tag -a "v$VERSION" -m "Loskai $VERSION"
log "Released $VERSION — push the tag: git push origin v$VERSION"
