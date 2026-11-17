#!/usr/bin/env bash
#
# release.sh — build Loskai's two images, push them tagged with the version and `latest`,
# and tag the commit.
#
#   make release VERSION=0.1.0                                  # to ghcr.io/simplysunde
#   make release VERSION=0.1.0 LOSKAI_REGISTRY=<host>/<owner>   # anywhere else, e.g. a Forgejo
#
# The images are what the compose files run: <registry>/loskai (the Dockerfile) and
# <registry>/loskai-caddy (caddy/Dockerfile), for amd64 and arm64 (a Raspberry Pi).
#
# What it checks before building, so a long build never ends in a refusal: the tree is
# clean and its commit is on origin/main (an image is always a published commit), the
# version isn't tagged yet, CHANGELOG.md has its heading, and you are logged in to the
# registry. What it does for you: QEMU for the platform this machine isn't (until reboot).
# What it asks you: one yes, after saying what it will publish. Then it builds, pushes,
# tags the commit v<VERSION> and pushes that tag to origin — only once both images are up,
# so a failed run leaves no tag and can be rerun with the same version.
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
grep -q "^## $VERSION " CHANGELOG.md || die "CHANGELOG.md has no '## $VERSION — <date>' heading yet"
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main || die "push this commit to origin first — the tag must name a commit the repo has"
host="${REGISTRY%%/*}"
grep -q "\"$host\"" "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null \
	|| die "log in to $host first: echo '<token>' | docker login $host -u <user> --password-stdin"

# The default builder can't build for several platforms; a docker-container one can. Host
# networking lets it push to a registry on this machine too.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 \
	|| docker buildx create --name "$BUILDER" --driver docker-container --driver-opt network=host >/dev/null
missing() {
	local supported p out=""
	supported="$(docker buildx inspect "$BUILDER" --bootstrap | sed -n 's/^Platforms: *//p')"
	for p in ${PLATFORMS//,/ }; do
		[[ ", $supported," == *", $p,"* ]] || out+=" ${p#linux/}"
	done
	echo "${out# }"
}
need="$(missing)"
if [ -n "$need" ]; then
	log "Installing QEMU for $need, so this machine can build for it (until reboot)"
	docker run --privileged --rm tonistiigi/binfmt --install "${need// /,}" >/dev/null
	docker buildx stop "$BUILDER" # it reads the platforms it can build when it starts
	need="$(missing)"
	[ -z "$need" ] || die "still can't build for $need after installing QEMU"
fi

commit="$(git rev-parse --short HEAD)"
cat <<EOF

Release $VERSION, from $commit ($(git log -1 --format=%s)):
  $REGISTRY/loskai:$VERSION        and :latest
  $REGISTRY/loskai-caddy:$VERSION  and :latest
  for ${PLATFORMS//linux\//}
  then tag v$VERSION and push it to origin
EOF
read -r -p "Publish? [y/N] " answer
[[ "$answer" == [yY] ]] || die "nothing published"

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
git push origin "v$VERSION"
log "Released $VERSION — the images are pushed, and v$VERSION is on origin"
