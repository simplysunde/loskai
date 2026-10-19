"""Tier-1: the stack editor's form — a stack's files read as fields and written back,
changing only what the form shows."""

import pytest
import yaml

from loskai.modules.docker import recipes, stackform, stacks
from loskai.modules.docker.stacks import StackError

COMPOSE = """\
# A comment that mentions ${NOT_A_SETTING}.
services:
  jellyfin:
    image: jellyfin/jellyfin:12.2
    ports:
      - "${PORT:-8096}:8096"
    volumes:
      - ./config:/config
      - cache:/cache
volumes:
  cache:
"""


# --- Pure: .env ---


def test_env_values_read_as_compose_reads_them():
    text = 'PORT="8080"\n# TZ=nope\nexport A=plain # note\nB=\'it$s\'\nC="pa\\$s \\"q\\""\n'
    assert stackform.parse_env(text) == {"PORT": "8080", "A": "plain", "B": "it$s", "C": 'pa$s "q"'}


def test_a_changed_value_is_rewritten_in_place_and_the_rest_kept():
    text = '# answers\nPORT="8080"\nTZ="Europe/Oslo"\n'
    assert stackform.set_env(text, {"PORT": "9000"}) == '# answers\nPORT="9000"\nTZ="Europe/Oslo"\n'
    assert stackform.set_env(text, {"NEW": "a$b"}) == text + 'NEW="a\\$b"\n'
    # Cleared: the line goes, so the compose default applies again.
    assert stackform.set_env(text, {"TZ": ""}) == '# answers\nPORT="8080"\n'
    assert stackform.set_env("", {"PORT": ""}) == ""


# --- Pure: compose.yml ---


def test_the_variables_come_from_the_file_not_its_comments():
    doc = yaml.safe_load(COMPOSE)
    assert stackform.referenced(doc) == {"PORT": "8096"}


def test_interpolation_shows_the_value_as_it_will_be():
    assert stackform.interpolate("${PORT:-8096}:80", {}) == "8096:80"
    assert stackform.interpolate("${PORT:-8096}:80", {"PORT": "9000"}) == "9000:80"
    assert stackform.interpolate("${PORT:-8096}", {"PORT": ""}) == "8096"
    assert stackform.interpolate("${PORT-8096}", {"PORT": ""}) == ""
    assert stackform.interpolate("$$HOME $TZ", {"TZ": "UTC"}) == "$HOME UTC"


def test_the_app_is_its_values():
    [app] = stackform.app_summary(yaml.safe_load(COMPOSE), {"PORT": "9000"})
    assert app == {
        "service": "jellyfin",
        "image": "jellyfin/jellyfin:12.2",
        "network": None,
        "ports": ["9000 → 8096"],
        "volumes": ["./config → /config", "cache → /cache"],
    }
    [ro] = stackform.app_summary({"services": {"a": {"build": ".", "volumes": ["./x:/x:ro"]}}}, {})
    assert ro["image"] == "built from source" and ro["volumes"] == ["./x → /x (read-only)"]


# --- Pure: compose.override.yml ---


def test_override_folders_in_either_syntax_become_rows():
    install = recipes.render_override("jellyfin", [("/srv/media/anime", "/media/anime")], False)
    assert stackform.parse_override(install) == (
        [{"service": "jellyfin", "source": "/srv/media/anime", "target": "/media/anime", "writable": True}],
        False,
    )
    short = "services:\n  jellyfin:\n    volumes:\n      - /srv/music:/music:ro\n"
    assert stackform.parse_override(short) == (
        [{"service": "jellyfin", "source": "/srv/music", "target": "/music", "writable": False}],
        False,
    )
    assert stackform.parse_override("") == ([], False)


def test_what_the_form_cant_show_is_flagged():
    for text in (
        "services:\n  jellyfin:\n    environment:\n      - A=b\n",
        "services:\n  jellyfin:\n    volumes:\n      - media:/media\n",
        "services:\n  jellyfin:\n    volumes:\n      - type: tmpfs\n        target: /tmp\n",
        "networks:\n  x: {}\n",
    ):
        assert stackform.parse_override(text)[1], text


def test_rebuilding_replaces_the_folders_and_keeps_everything_else():
    text = (
        "services:\n  jellyfin:\n    environment:\n      - A=b\n"
        "    volumes:\n      - /old:/old\n      - media:/media\n"
    )
    rows = [
        {"service": "jellyfin", "source": "/srv/anime", "target": "/media/anime", "writable": True},
        {"service": "jellyfin", "source": "/srv/$music", "target": "/music", "writable": False},
    ]
    out = stackform.build_override(text, rows)
    assert out.startswith(recipes.OVERRIDE_HEADER)
    svc = yaml.safe_load(out)["services"]["jellyfin"]
    assert svc["environment"] == ["A=b"]
    assert svc["volumes"] == [
        recipes.bind_volume("/srv/anime", "/media/anime", False),
        recipes.bind_volume("/srv/$music", "/music", True),
        "media:/media",
    ]
    assert svc["volumes"][1]["source"] == "/srv/$$music"
    # Round trip: the rows read back as written.
    assert stackform.parse_override(out)[0] == rows


def test_no_folders_and_nothing_else_removes_the_override():
    install = recipes.render_override("jellyfin", [("/srv/a", "/media/a")], False)
    assert stackform.build_override(install, []) is None


def test_folders_are_checked_before_anything_is_written():
    ok = {"service": "app", "source": "/srv/a", "target": "/a", "writable": True}
    assert stackform.folders_problem([ok], {"app"}) is None
    assert "not a service" in stackform.folders_problem([{**ok, "service": "web"}], {"app"})
    assert "no host path" in stackform.folders_problem([{**ok, "source": " "}], {"app"})
    assert "/root" in stackform.folders_problem([{**ok, "source": "~/media"}], {"app"})
    assert "must start with /" in stackform.folders_problem([{**ok, "target": "media"}], {"app"})
    assert "two folders land at /a" in stackform.folders_problem([ok, {**ok, "source": "/srv/b"}], {"app"})


# --- The stack on disk ---


@pytest.fixture
def stack(tmp_path):
    folder = stacks.stacks_dir() / "jellyfin"
    folder.mkdir(parents=True)
    (folder / "compose.yml").write_text(COMPOSE)
    (folder / ".env").write_text('# kept\nPORT="8096"\n')
    (folder / "compose.override.yml").write_text(
        recipes.render_override("jellyfin", [("/srv/media/anime", "/media/anime")], False)
    )
    return folder


def test_the_form_reads_the_stacks_files(stack):
    form = stackform.get_form("jellyfin")
    assert form["settings"] == [{"key": "PORT", "label": None, "value": "8096", "default": "8096"}]
    assert form["folders"] == [
        {"service": "jellyfin", "source": "/srv/media/anime", "target": "/media/anime", "writable": True}
    ]
    assert form["services"] == ["jellyfin"]
    assert form["app"][0]["ports"] == ["8096 → 8096"]
    assert not form["override_other"] and not form["override_comments"]
    assert form["recipe"] is None


def test_a_recipe_stack_labels_its_settings_with_the_questions(stack, tmp_path):
    folder = tmp_path / "data" / "recipes" / "jellyfin"
    folder.mkdir(parents=True)
    (folder / "recipe.yml").write_text(
        'name: Jellyfin\ntype: pull\nenv:\n  - key: PORT\n    label: Host port\n    default: "8096"\n'
        "  - key: TZ\n    label: Time zone\n    default: Europe/Oslo\n"
    )
    (folder / "compose.yml").write_text(COMPOSE)
    form = stackform.get_form("jellyfin")
    assert form["recipe"] == {"id": "jellyfin", "name": "Jellyfin", "icon": False}
    assert form["settings"] == [
        {"key": "PORT", "label": "Host port", "value": "8096", "default": "8096"},
        {"key": "TZ", "label": "Time zone", "value": "", "default": "Europe/Oslo"},
    ]


def test_saving_writes_only_what_changed(stack):
    compose_before = (stack / "compose.yml").read_text()
    stackform.save_form(
        "jellyfin",
        {"PORT": "9000"},
        [
            {"service": "jellyfin", "source": "/srv/media/anime", "target": "/media/anime", "writable": True},
            {"service": "jellyfin", "source": "/srv/media/films", "target": "/media/films", "writable": False},
        ],
    )
    assert (stack / ".env").read_text() == '# kept\nPORT="9000"\n'
    assert (stack / ".env").stat().st_mode & 0o777 == 0o600
    assert (stack / "compose.yml").read_text() == compose_before
    assert [f["target"] for f in stackform.get_form("jellyfin")["folders"]] == ["/media/anime", "/media/films"]

    env_before = (stack / ".env").read_text()
    stackform.save_form("jellyfin", None, [])
    assert not (stack / "compose.override.yml").exists()
    assert (stack / ".env").read_text() == env_before


def test_a_bad_folder_writes_nothing(stack):
    override_before = (stack / "compose.override.yml").read_text()
    with pytest.raises(StackError, match="must start with /"):
        stackform.save_form(
            "jellyfin",
            {"PORT": "9000"},
            [{"service": "jellyfin", "source": "/srv/x", "target": "x", "writable": True}],
        )
    assert (stack / ".env").read_text() == '# kept\nPORT="8096"\n'
    assert (stack / "compose.override.yml").read_text() == override_before


def test_a_setting_must_be_a_variable_name(stack):
    with pytest.raises(StackError, match="not a variable name"):
        stackform.save_form("jellyfin", {"BAD KEY": "x"}, None)


def test_only_the_users_own_comments_are_warned_about(stack):
    override = stack / "compose.override.yml"
    body = "services:\n  jellyfin:\n    volumes:\n      - /srv/a:/a\n"
    override.write_text("# Folders added in Loskai's install wizard. Reinstall to change them.\n" + body)
    assert not stackform.get_form("jellyfin")["override_comments"]
    override.write_text("# my note\n" + body)
    assert stackform.get_form("jellyfin")["override_comments"]


def test_a_preview_returns_the_files_and_writes_nothing(stack):
    env_before = (stack / ".env").read_text()
    override_before = (stack / "compose.override.yml").read_text()
    out = stackform.save_form(
        "jellyfin",
        {"PORT": "9000"},
        [
            {"service": "jellyfin", "source": "/srv/media/anime", "target": "/media/anime", "writable": True},
            {"service": "jellyfin", "source": "", "target": "", "writable": True},
        ],
        preview=True,
    )
    assert out["env"] == '# kept\nPORT="9000"\n'
    assert stackform.parse_override(out["override"])[0] == [
        {"service": "jellyfin", "source": "/srv/media/anime", "target": "/media/anime", "writable": True}
    ]
    assert (stack / ".env").read_text() == env_before
    assert (stack / "compose.override.yml").read_text() == override_before


def test_a_blank_folder_row_is_skipped_not_refused(stack):
    stackform.save_form("jellyfin", None, [{"service": "jellyfin", "source": " ", "target": "", "writable": True}])
    assert not (stack / "compose.override.yml").exists()


def test_the_form_reads_unsaved_text_and_saves_on_top_of_it(stack):
    disk_override = (stack / "compose.override.yml").read_text()
    base = {
        "env": 'PORT="9100"\n',
        "override": "services:\n  jellyfin:\n    devices:\n      - /dev/dri:/dev/dri\n"
        "    volumes:\n      - /srv/a:/a\n",
    }
    form = stackform.get_form("jellyfin", base)
    assert form["settings"][0]["value"] == "9100"
    assert [f["target"] for f in form["folders"]] == ["/a"]
    assert form["override_other"]
    assert (stack / "compose.override.yml").read_text() == disk_override

    # Saved with no further change: the text view's files are what lands.
    stackform.save_form("jellyfin", None, None, base=base)
    assert (stack / ".env").read_text() == base["env"]
    assert (stack / "compose.override.yml").read_text() == base["override"]

    # A folder changed on top keeps the text's devices line.
    stackform.save_form(
        "jellyfin", {"PORT": "9200"},
        [{"service": "jellyfin", "source": "/srv/b", "target": "/b", "writable": True}], base=base,
    )
    svc = yaml.safe_load((stack / "compose.override.yml").read_text())["services"]["jellyfin"]
    assert svc["devices"] == ["/dev/dri:/dev/dri"]
    assert [v["target"] for v in svc["volumes"]] == ["/b"]
    assert (stack / ".env").read_text() == 'PORT="9200"\n'


def test_unsaved_text_that_doesnt_load_is_refused_with_its_line(stack):
    with pytest.raises(StackError, match="compose.override.yml line 2"):
        stackform.get_form("jellyfin", {"env": "", "override": "services:\n\tx: {}\n"})
