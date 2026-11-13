"""Installing a recipe: the container it links to, a reinstall, the folders and options it
writes, and its icon."""

import pytest

from loskai.modules.docker import install, logic, manifest, override, recipes
from loskai.shared import instances as instances_store

from conftest import make_recipe


# --- Which container an installed recipe links to (pure) ---


def _c(service, name, published=False):
    return {"service": service, "name": name, "ports": {"80/tcp": [{"HostPort": "8080"}] if published else None}}


def test_primary_container_single_service():
    assert logic.primary_container([_c("app", "grafana-app-1")]) == "grafana-app-1"


def test_primary_container_prefers_the_declared_service():
    containers = [_c("app", "immich-app-1"), _c("db", "immich-db-1")]
    assert logic.primary_container(containers, "db") == "immich-db-1"


def test_primary_container_ignores_a_declared_service_that_is_not_there():
    containers = [_c("app", "immich-app-1", published=True), _c("db", "immich-db-1")]
    assert logic.primary_container(containers, "web") == "immich-app-1"


def test_primary_container_prefers_the_published_service():
    containers = [_c("db", "immich-db-1"), _c("web", "immich-web-1", published=True)]
    assert logic.primary_container(containers) == "immich-web-1"


def test_primary_container_falls_back_to_a_stable_order():
    containers = [_c("web", "app-web-1", published=True), _c("api", "app-api-1", published=True)]
    assert logic.primary_container(containers) == "app-api-1"


def test_primary_container_none_when_nothing_came_up():
    assert logic.primary_container([]) is None


# --- Install (the instance links to the real container name) ---


@pytest.fixture
def installable(data_dir, monkeypatch):
    """A local recipe plus a stubbed compose run — the install path without a daemon."""
    make_recipe(
        data_dir / "recipes",
        "grafana",
        "Grafana",
        'env:\n  - key: PORT\n    label: Host port\n    default: "3000"\n'
        "  - key: PW\n    label: Admin password\n    secret: true\n",
    )
    monkeypatch.setattr(install.stacks, "run_compose", lambda d, *args: {"ok": True, "output": "Started"})
    # The reinstall check asks Docker which containers exist; never the real daemon here.
    monkeypatch.setattr(install.docker_client, "container_names", lambda: set())
    return data_dir


def _fake_project(monkeypatch, containers):
    monkeypatch.setattr(
        install.docker_client, "containers_in_project", lambda project: containers
    )


def test_install_links_the_instance_to_the_compose_container(installable, monkeypatch):
    """Compose names the container `<project>-<service>-1`, so the recipe id is not it —
    and the instance join in logic.py matches on the name."""
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    result = install.install_recipe("grafana", {"PORT": "3000"})

    assert result["ok"] and result["container"] == "grafana-app-1"
    instance = instances_store.get_instance("grafana")
    assert instance.container == "grafana-app-1"
    # The join the Docker tab and the Routing table actually use.
    assert logic.orphaned_instances([instance], {"grafana-app-1"}) == []


def test_install_writes_the_generated_env(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    install.install_recipe("grafana", {"PORT": "3000", "PW": "pa$word1"})
    stack = install.stacks.stacks_dir() / "grafana"
    assert (stack / ".env").read_text() == 'PORT="3000"\nPW="pa\\$word1"\n'
    assert (stack / ".env").stat().st_mode & 0o777 == 0o600  # only its owner reads the password
    assert "image: x" in (stack / "compose.yml").read_text()


def test_install_fills_defaults_for_missing_answers(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    install.install_recipe("grafana", {})
    env = (install.stacks.stacks_dir() / "grafana" / ".env").read_text()
    assert env == 'PORT="3000"\nPW=""\n'


def test_install_refuses_an_undeclared_answer_before_touching_disk(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    with pytest.raises(manifest.RecipeError, match="not declared"):
        install.install_recipe("grafana", {"COMPOSE_PROJECT_NAME": "hijacked"})
    assert not (install.stacks.stacks_dir() / "grafana").exists()


def test_failed_compose_registers_no_instance(installable, monkeypatch):
    monkeypatch.setattr(install.stacks, "run_compose", lambda d, *args: {"ok": False, "output": "boom"})
    _fake_project(monkeypatch, [])
    result = install.install_recipe("grafana", {})
    assert result["ok"] is False and result["instance_id"] is None
    assert instances_store.get_instance("grafana") is None


def test_unidentifiable_container_warns_instead_of_guessing(installable, monkeypatch):
    """No container to name means no instance: a wrong `container` would sit in the list
    as a second, permanently orphaned record beside the one the Routing tab creates."""
    _fake_project(monkeypatch, [])
    result = install.install_recipe("grafana", {})
    assert result["ok"] is True and result["instance_id"] is None
    assert "could not be identified" in result["warning"]
    assert instances_store.get_instance("grafana") is None


def test_install_survives_a_daemon_that_went_away(installable, monkeypatch):
    def boom(project):
        raise OSError("socket gone")

    monkeypatch.setattr(install.docker_client, "containers_in_project", boom)
    result = install.install_recipe("grafana", {})
    assert result["ok"] is True and result["warning"]


def test_install_refuses_a_duplicate_stack(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    install.install_recipe("grafana", {})
    with pytest.raises(install.stacks.StackError, match="already exists"):
        install.install_recipe("grafana", {})


# --- Reinstalling: the folder's data and the route record both survive ---


def test_install_reuses_the_folder_a_kept_delete_left(installable, monkeypatch):
    """Delete keeps a stack's data by default; installing it again picks the folder up."""
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    leftover = install.stacks.stacks_dir() / "grafana" / "data"
    leftover.mkdir(parents=True)
    (leftover / "grafana.db").write_text("dashboards")

    result = install.install_recipe("grafana", {})

    assert result["ok"] and result["reused_data"] is True
    assert (leftover / "grafana.db").read_text() == "dashboards"
    assert (install.stacks.stacks_dir() / "grafana" / "compose.yml").is_file()


def test_a_fresh_install_reports_no_reused_data(installable, monkeypatch):
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert install.install_recipe("grafana", {})["reused_data"] is False


def test_reinstall_keeps_the_route_record(installable, monkeypatch):
    """The open Phase 28 bug: a reinstall replaced the record wholesale, wiping its route
    fields while Caddy kept serving the route."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="My dashboards", type="docker", container="grafana-old-1",
        subdomain="graf", upstream="192.168.10.220:3000", private=True, icon="grafana.png",
        follow_container=True,
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    install.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.container == "grafana-app-1"  # re-pointed at what exists now
    assert (inst.name, inst.subdomain, inst.upstream) == ("My dashboards", "graf", "192.168.10.220:3000")
    assert inst.private and inst.icon == "grafana.png" and inst.follow_container


def test_a_change_made_during_a_reinstall_s_up_is_kept(installable, monkeypatch):
    """`up` can take minutes; the follower re-points the route, or the user edits it."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="Grafana", type="docker", container="grafana-old-1",
        subdomain="graf", upstream="192.168.10.220:3000", follow_container=True,
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    def up(directory, *args):
        instances_store.update_fields("grafana", upstream="192.168.10.220:3001", private=True)
        return {"ok": True, "output": "Started"}

    monkeypatch.setattr(install.stacks, "run_compose", up)
    install.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.container == "grafana-app-1"
    assert inst.upstream == "192.168.10.220:3001" and inst.private


def test_a_reinstalled_record_with_no_icon_gets_the_recipe_s(installable, monkeypatch):
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(id="grafana", name="Grafana", type="docker", container="grafana-old-1"))
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    install.install_recipe("grafana", {})

    assert instances_store.get_instance("grafana").icon


def test_an_id_that_names_an_external_route_is_refused(installable, monkeypatch):
    """A route's id is its prefix — a hand-made route at the recipe's name is not ours."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="grafana", type="external", subdomain="grafana",
        upstream="192.168.10.60:3000",
    ))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    with pytest.raises(manifest.RecipeError, match="already the name of a route"):
        install.install_recipe("grafana", {})
    assert not (install.stacks.stacks_dir() / "grafana").exists()  # refused before any side effect
    assert instances_store.get_instance("grafana").type == "external"


def test_an_id_linked_to_another_running_container_is_refused(installable, monkeypatch):
    """A route to a hand-run container named for the same app — still running — is not
    this recipe's earlier install."""
    from loskai.shared.instances import Instance

    instances_store.upsert_instance(Instance(
        id="grafana", name="grafana", type="docker", container="grafana", subdomain="grafana",
    ))
    monkeypatch.setattr(install.docker_client, "container_names", lambda: {"grafana"})
    _fake_project(monkeypatch, [])

    with pytest.raises(manifest.RecipeError, match="route to container 'grafana'"):
        install.install_recipe("grafana", {})
    assert instances_store.get_instance("grafana").container == "grafana"


# --- mounts: the folders the user adds at install, however many they have ---

MEDIA = "mounts:\n  label: Media folders\n  target: /media\n"


@pytest.mark.parametrize(
    "mounts,problem",
    [
        ("folders", "must be a mapping"),
        ({"target": "/media"}, "needs a 'label'"),
        ({"label": "Media"}, "absolute container path"),
        ({"label": "Media", "target": "media"}, "absolute container path"),
        ({"label": "Media", "target": "/"}, "absolute container path"),
        ({"label": "Media", "target": "/a:b"}, "absolute container path"),
        ({"label": "Media", "target": "/media", "read_only": "yes"}, "true or false"),
    ],
)
def test_mounts_block_is_validated(mounts, problem):
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "mounts": mounts})
    assert any(problem in e for e in errors), errors


def test_mounts_go_into_the_only_service_read_only_by_default(data_dir):
    make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA)
    mounts = recipes.get_recipe("jellyfin")["mounts"]
    assert mounts == {"label": "Media folders", "target": "/media", "read_only": True, "service": "app"}


def test_mounts_in_a_multi_service_recipe_need_its_service(data_dir):
    folder = make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA)
    (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n  db:\n    image: y\n")
    result = recipes.list_recipes()
    assert any("needs 'service'" in i["error"] for i in result["invalid"])


def test_mounts_service_must_be_in_the_compose_file(data_dir):
    make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", MEDIA + "service: web\n")
    result = recipes.list_recipes()
    assert any("'service: web' is not a service" in i["error"] for i in result["invalid"])


MEDIA_SPEC = {"label": "Media folders", "target": "/media", "read_only": True, "service": "app"}


def test_each_folder_lands_under_the_target_by_its_own_name():
    folders = ["/srv/scloud/media/anime", "/srv/scloud/media/movies/", "./music"]
    assert manifest.resolve_mounts(MEDIA_SPEC, folders) == [
        ("/srv/scloud/media/anime", "/media/anime"),
        ("/srv/scloud/media/movies/", "/media/movies"),
        ("./music", "/media/music"),
    ]


def test_two_folders_with_one_name_are_refused():
    with pytest.raises(manifest.RecipeError, match="would both land at /media/anime"):
        manifest.resolve_mounts(MEDIA_SPEC, ["/disk1/anime", "/disk2/anime"])


@pytest.mark.parametrize(
    "folder,reason",
    [
        ("~/anime", "container's home"),
        ("anime", "is a Docker volume"),
        ("", "a folder is empty"),
        ("/", "no folder name"),
    ],
)
def test_a_bad_folder_is_refused_with_the_reason(folder, reason):
    with pytest.raises(manifest.RecipeError, match=reason):
        manifest.resolve_mounts(MEDIA_SPEC, [folder])


def test_folders_for_a_recipe_without_mounts_are_refused():
    with pytest.raises(manifest.RecipeError, match="takes no extra folders"):
        manifest.resolve_mounts(None, ["/srv/media"])
    assert manifest.resolve_mounts(None, []) == []


def test_override_is_long_syntax_that_never_creates_a_folder():
    """The short form has Docker create a mistyped folder, empty and root-owned, and the
    install succeeds with an empty library. `create_host_path: false` fails it instead."""
    import yaml

    text = override.render_override("app", [("/srv/my$stuff", "/media/my$stuff")], True)
    volume = yaml.safe_load(text)["services"]["app"]["volumes"][0]
    assert volume == {
        "type": "bind",
        # Compose interpolates the override too: `$$` is a literal `$`.
        "source": "/srv/my$$stuff",
        "target": "/media/my$$stuff",
        "read_only": True,
        "bind": {"create_host_path": False},
    }


@pytest.fixture
def jellyfin(installable, monkeypatch):
    make_recipe(installable / "recipes", "jellyfin", "Jellyfin", MEDIA)
    _fake_project(monkeypatch, [_c("app", "jellyfin-app-1")])
    return install.stacks.stacks_dir() / "jellyfin"


def test_install_writes_the_folders_into_an_override(jellyfin):
    import yaml

    install.install_recipe("jellyfin", {}, ["/srv/media/anime", "/srv/media/music"])

    volumes = yaml.safe_load((jellyfin / "compose.override.yml").read_text())["services"]["app"]["volumes"]
    assert [(v["source"], v["target"]) for v in volumes] == [
        ("/srv/media/anime", "/media/anime"),
        ("/srv/media/music", "/media/music"),
    ]
    # The recipe's own compose file is copied untouched.
    assert (jellyfin / "compose.yml").read_text() == "services:\n  app:\n    image: x\n"


def test_install_without_folders_writes_no_override(jellyfin):
    install.install_recipe("jellyfin", {})
    assert not (jellyfin / "compose.override.yml").exists()


def test_a_bad_folder_fails_before_touching_disk(jellyfin):
    with pytest.raises(manifest.RecipeError, match="is a Docker volume"):
        install.install_recipe("jellyfin", {}, ["anime"])
    assert not jellyfin.exists()


# --- options: features switched on in the form or the wizard ---

GPU = (
    "options:\n  - id: hwaccel\n    label: Hardware transcoding\n    help: Needs /dev/dri\n"
    "    set:\n      devices:\n        - /dev/dri:/dev/dri\n"
)
HWACCEL = {
    "id": "hwaccel", "label": "Hardware transcoding", "help": "Needs /dev/dri", "service": "app",
    "set": {"devices": ["/dev/dri:/dev/dri"]},
}


@pytest.mark.parametrize(
    "options,problem",
    [
        ("gpu", "must be a list"),
        ([{"label": "GPU", "set": {"devices": ["/dev/dri"]}}], "needs an 'id'"),
        ([{"id": "GPU!", "label": "GPU", "set": {"devices": ["/dev/dri"]}}], "needs an 'id'"),
        ([{"id": "gpu", "set": {"devices": ["/dev/dri"]}}], "needs a 'label'"),
        ([{"id": "gpu", "label": "GPU"}], "needs 'set'"),
        ([{"id": "gpu", "label": "GPU", "set": {"image": ["evil"]}}], "can't set 'image'"),
        ([{"id": "gpu", "label": "GPU", "set": {"volumes": ["/:/host"]}}], "can't set 'volumes'"),
        ([{"id": "gpu", "label": "GPU", "set": {"devices": "/dev/dri"}}], "must be a list"),
        (
            [{"id": "gpu", "label": "A", "set": {"devices": ["/a"]}}, {"id": "gpu", "label": "B", "set": {"devices": ["/b"]}}],
            "used twice",
        ),
    ],
)
def test_options_are_validated(options, problem):
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "options": options})
    assert any(problem in e for e in errors), errors


def test_an_option_goes_into_the_only_service(data_dir):
    make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", GPU)
    assert recipes.get_recipe("jellyfin")["options"] == [HWACCEL]


def test_an_option_in_a_multi_service_recipe_needs_its_service(data_dir):
    folder = make_recipe(data_dir / "recipes", "jellyfin", "Jellyfin", GPU)
    (folder / "compose.yml").write_text("services:\n  app:\n    image: x\n  db:\n    image: y\n")
    assert any("options[0] needs 'service'" in i["error"] for i in recipes.list_recipes()["invalid"])


def test_switching_an_option_adds_and_removes_exactly_its_lines():
    import yaml

    base = "services:\n  app:\n    devices:\n      - /dev/ttyUSB0:/dev/ttyUSB0\n"
    on = override.set_options(base, [HWACCEL], {"hwaccel": True})
    assert yaml.safe_load(on)["services"]["app"]["devices"] == ["/dev/ttyUSB0:/dev/ttyUSB0", "/dev/dri:/dev/dri"]
    assert override.option_on(on, HWACCEL) and not override.option_on(base, HWACCEL)
    # On twice is still once.
    assert override.set_options(on, [HWACCEL], {"hwaccel": True}) == on
    off = override.set_options(on, [HWACCEL], {"hwaccel": False})
    assert yaml.safe_load(off)["services"]["app"]["devices"] == ["/dev/ttyUSB0:/dev/ttyUSB0"]
    # Off with nothing else left: no override at all.
    assert override.set_options(override.set_options("", [HWACCEL], {"hwaccel": True}), [HWACCEL], {"hwaccel": False}) == ""


def test_an_option_for_an_empty_service_entry_is_added():
    on = override.set_options("services:\n  app:\n", [HWACCEL], {"hwaccel": True})
    assert override.option_on(on, HWACCEL)


@pytest.mark.parametrize("entry", ["[]", '""'])
def test_an_option_never_replaces_a_service_entry_that_isnt_a_mapping(entry):
    with pytest.raises(override.OverrideError, match="isn't a mapping"):
        override.set_options(f"services:\n  app: {entry}\n", [HWACCEL], {"hwaccel": True})


def test_a_hand_pasted_snippet_reads_as_on():
    pasted = "services:\n  app:\n    devices:\n    - /dev/dri:/dev/dri\n"
    assert override.option_on(pasted, HWACCEL)


def test_an_override_the_option_cant_switch_is_said():
    weird = "services:\n  app:\n    devices: /dev/dri\n"
    with pytest.raises(override.OverrideError, match="isn't a list"):
        override.set_options(weird, [HWACCEL], {"hwaccel": True})


NVIDIA = {
    "id": "nvidia", "label": "NVIDIA", "help": None, "service": "app",
    "set": {"deploy": {"resources": {"reservations": {"devices": [
        {"driver": "nvidia", "count": "all", "capabilities": ["gpu"]}
    ]}}}},
}


def test_a_gpu_reservation_is_added_and_removed_inside_what_is_there():
    import yaml

    base = "services:\n  app:\n    deploy:\n      resources:\n        limits:\n          memory: 4g\n"
    on = override.set_options(base, [NVIDIA], {"nvidia": True})
    deploy = yaml.safe_load(on)["services"]["app"]["deploy"]
    assert deploy["resources"]["limits"] == {"memory": "4g"}
    assert deploy["resources"]["reservations"]["devices"][0]["driver"] == "nvidia"
    assert override.option_on(on, NVIDIA)
    off = override.set_options(on, [NVIDIA], {"nvidia": False})
    assert yaml.safe_load(off)["services"]["app"]["deploy"] == {"resources": {"limits": {"memory": "4g"}}}
    assert override.set_options(override.set_options("", [NVIDIA], {"nvidia": True}), [NVIDIA], {"nvidia": False}) == ""


def test_an_option_never_overwrites_a_value_set_otherwise():
    clash = {**NVIDIA, "set": {"deploy": {"replicas": 1}}}
    with pytest.raises(override.OverrideError, match="is already 3"):
        override.set_options("services:\n  app:\n    deploy:\n      replicas: 3\n", [clash], {"nvidia": True})


def test_a_port_reads_the_same_as_a_number_or_text():
    dlna = {"id": "dlna", "label": "DLNA", "help": None, "service": "app", "set": {"ports": ["1900:1900/udp", 7359]}}
    assert override.option_on("services:\n  app:\n    ports:\n    - 1900:1900/udp\n    - '7359'\n", dlna)


def test_deploy_must_be_a_mapping():
    errors = manifest.validate_manifest(
        {"name": "X", "type": "pull", "options": [{"id": "gpu", "label": "GPU", "set": {"deploy": ["nvidia"]}}]}
    )
    assert any("'deploy' must be a mapping" in e for e in errors), errors


@pytest.fixture
def gpu_recipe(installable, monkeypatch):
    make_recipe(installable / "recipes", "jellyfin", "Jellyfin", MEDIA + GPU)
    _fake_project(monkeypatch, [_c("app", "jellyfin-app-1")])
    return install.stacks.stacks_dir() / "jellyfin"


def test_install_writes_the_chosen_options_beside_the_folders(gpu_recipe):
    import yaml

    install.install_recipe("jellyfin", {}, ["/srv/media/anime"], ["hwaccel"])
    svc = yaml.safe_load((gpu_recipe / "compose.override.yml").read_text())["services"]["app"]
    assert svc["devices"] == ["/dev/dri:/dev/dri"]
    assert [v["target"] for v in svc["volumes"]] == ["/media/anime"]


def test_install_with_an_option_and_no_folders_still_writes_it(gpu_recipe):
    install.install_recipe("jellyfin", {}, [], ["hwaccel"])
    assert override.option_on((gpu_recipe / "compose.override.yml").read_text(), HWACCEL)


def test_an_unknown_option_fails_before_touching_disk(gpu_recipe):
    with pytest.raises(manifest.RecipeError, match="no option nvidia"):
        install.install_recipe("jellyfin", {}, [], ["nvidia"])
    assert not gpu_recipe.exists()


# --- Icon: an optional icon.png, applied to the route record at install ---

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_a_recipe_with_an_icon_says_so(installable):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)

    listed = {r["id"]: r for r in recipes.list_recipes()["recipes"]}
    assert listed["grafana"]["icon"] is True
    assert recipes.icon_path("grafana").read_bytes() == PNG


def test_a_recipe_without_an_icon_has_none(installable):
    assert recipes.get_recipe("grafana")["icon"] is False
    with pytest.raises(manifest.RecipeError, match="has no icon") as missing:
        recipes.icon_path("grafana")
    assert missing.value.status_code == 404


@pytest.mark.parametrize(
    "data,reason",
    [
        (b"\xff\xd8\xff" + b"\x00" * 32, "not a PNG"),  # a JPEG named .png
        (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "unsupported image"),
        (PNG + b"\x00" * (512 * 1024), "larger than"),
    ],
)
def test_a_bad_icon_skips_the_recipe_with_the_reason(installable, data, reason):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(data)

    skipped = {r["id"]: r["error"] for r in recipes.list_recipes()["invalid"]}
    assert reason in skipped["grafana"]


def test_install_gives_the_route_the_recipe_icon(installable, monkeypatch):
    from loskai.shared import icons

    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    install.install_recipe("grafana", {})

    inst = instances_store.get_instance("grafana")
    assert inst.icon == "grafana.png"
    assert icons.path_for(inst.icon).read_bytes() == PNG


def _routed(container="grafana-app-1"):
    from loskai.shared.instances import Instance

    return Instance(id="graf", name="graf", type="docker", container=container)


def _ran_in(monkeypatch, folder, project="grafana"):
    """The labels compose gives a container it started from `folder`."""
    labels = {"com.docker.compose.project": project, "com.docker.compose.project.working_dir": str(folder)}
    monkeypatch.setattr(install.docker_client, "labels_of", lambda name: labels)


def test_a_new_route_for_an_installed_recipe_gets_its_icon(installable, monkeypatch):
    """The install's record was deleted (its route removed), so a route added later makes a
    new one — which should get the icon the install gave."""
    from loskai.shared import icons

    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    install.install_recipe("grafana", {})
    instances_store.delete_instance("grafana")
    _ran_in(monkeypatch, install.stacks.stacks_dir() / "grafana")

    inst = install.recipe_icon(_routed())
    assert inst.icon == "graf.png"
    assert icons.path_for(inst.icon).read_bytes() == PNG


def _moved_in(installable, name="grafana"):
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    stack = install.stacks.stacks_dir() / name
    stack.mkdir(parents=True)
    (stack / "compose.yml").write_text("services: {}\n")
    return stack


def test_a_stack_moved_in_by_hand_gets_its_recipes_icon_by_name(installable, monkeypatch):
    _ran_in(monkeypatch, _moved_in(installable))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert install.recipe_icon(_routed()).icon == "graf.png"


def test_the_stack_is_found_by_its_folder_not_its_project_name(installable, monkeypatch):
    """Compose lowercases the folder name and drops a dot to make the project name."""
    stack = _moved_in(installable, "Graf.Ana")
    (stack / install.stacks.RECORD_NAME).write_text('{"recipe": "grafana"}')
    _ran_in(monkeypatch, stack, project="grafana")
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    assert install.recipe_icon(_routed()).icon == "graf.png"


def test_only_the_recipes_own_container_gets_its_icon(installable, monkeypatch):
    _ran_in(monkeypatch, _moved_in(installable))
    _fake_project(monkeypatch, [_c("app", "grafana-app-1", published=True), _c("db", "grafana-db-1")])
    assert install.recipe_icon(_routed("grafana-app-1")).icon == "graf.png"
    assert install.recipe_icon(_routed("grafana-db-1")).icon is None


@pytest.mark.parametrize(
    "labels_of",
    [
        # Run from a same-named folder outside the stacks folder.
        lambda name: {"com.docker.compose.project": "grafana", "com.docker.compose.project.working_dir": "/home/me/grafana"},
        lambda name: {},  # started without compose
        lambda name: (_ for _ in ()).throw(OSError("no socket")),  # Docker unreachable
    ],
)
def test_no_icon_for_a_container_outside_a_recipe_stack(installable, monkeypatch, labels_of):
    _moved_in(installable)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])
    monkeypatch.setattr(install.docker_client, "labels_of", labels_of)
    assert install.recipe_icon(_routed()).icon is None


def test_reinstall_never_replaces_an_icon_chosen_by_hand(installable, monkeypatch):
    from loskai.shared import icons
    from loskai.shared.instances import Instance

    mine = b"\x89PNG\r\n\x1a\n" + b"\x01" * 64
    icons.save("grafana", mine)
    instances_store.upsert_instance(
        Instance(id="grafana", name="Grafana", type="docker", container="grafana-old-1", icon="grafana.png")
    )
    (installable / "recipes" / "grafana" / "icon.png").write_bytes(PNG)
    _fake_project(monkeypatch, [_c("app", "grafana-app-1")])

    install.install_recipe("grafana", {})

    assert icons.path_for(instances_store.get_instance("grafana").icon).read_bytes() == mine
