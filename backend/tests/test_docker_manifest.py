"""A recipe's manifest and the answers to it: the rules, checked without a folder or a daemon,
and the `.env` the answers are written to."""

import pytest

from loskai.modules.docker import dotenv, manifest


# --- Pure validation ---


def test_valid_pull_manifest():
    assert manifest.validate_manifest({"name": "Grafana", "type": "pull"}) == []


def test_name_must_be_text():
    assert any("name" in e for e in manifest.validate_manifest({"name": 2048, "type": "pull"}))


def test_missing_name_and_bad_type():
    errors = manifest.validate_manifest({"type": "nope"})
    assert any("name" in e for e in errors)
    assert any("type" in e for e in errors)


@pytest.mark.parametrize("rtype", ["git_build", "registry_pull"])
def test_the_dropped_install_patterns_are_refused(rtype):
    # Never used by a recipe, and gone: pull is the one pattern.
    assert manifest.validate_manifest({"name": "X", "type": rtype}) == ["'type' must be one of ['pull']"]


@pytest.mark.parametrize("value", ["https://login.example.com/", "https://login.example.com:8443/a/"])
def test_a_log_link_is_a_host_and_a_path(value):
    assert manifest.validate_manifest({"name": "X", "type": "pull", "log_link": value}) == []


@pytest.mark.parametrize("value", ["https://login.example.com", "http://login.example.com/", "login", 3])
def test_a_log_link_without_https_or_a_path_is_refused(value):
    # Without the path, the prefix would also match login.example.com.elsewhere.net.
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "log_link": value})
    assert any("log_link" in e for e in errors)


def test_env_entry_needs_key_and_label():
    errors = manifest.validate_manifest(
        {"name": "X", "type": "pull", "env": [{"key": "PORT"}]}
    )
    assert any("env[0]" in e for e in errors)


def test_render_env_quotes_every_value():
    assert dotenv.render_env({"PORT": "3000", "PW": "secret"}) == 'PORT="3000"\nPW="secret"\n'


# Each of these arrived at the container altered when written verbatim — and the install
# still *succeeded*. Encodings checked against `docker compose config` and a real
# container's environment on 2026-10-03 (see render_env).
@pytest.mark.parametrize(
    "value,encoded",
    [
        ("pa$word1", r'"pa\$word1"'),  # verbatim: interpolated, arrived as "pa"
        ("correct horse #battery", '"correct horse #battery"'),  # verbatim: cut at " #"
        ("it's", '"it\'s"'),  # the case single quotes cannot hold
        ('say "hi"', r'"say \"hi\""'),
        ("back\\slash", r'"back\\slash"'),
        ("a\\$b", r'"a\\\$b"'),  # backslash escaped first, or "\$" would decode to "$"
        ("x\nCOMPOSE_PROJECT_NAME=hijacked", r'"x\nCOMPOSE_PROJECT_NAME=hijacked"'),
        ("a\rb", r'"a\rb"'),
        ("", '""'),
    ],
)
def test_render_env_escapes_what_compose_would_rewrite(value, encoded):
    assert dotenv.render_env({"V": value}) == f"V={encoded}\n"


def test_a_newline_in_a_value_stays_on_one_line():
    """Verbatim, a newline started a second KEY= line — and COMPOSE_PROJECT_NAME in a .env
    re-points the project, and with it the container the install links to."""
    rendered = dotenv.render_env({"V": "x\nCOMPOSE_PROJECT_NAME=hijacked"})
    assert rendered.count("\n") == 1 and not rendered.startswith("COMPOSE")


# --- Answers: the server owns the value set, not the form ---


SPEC = [
    {"key": "PORT", "label": "Host port", "default": "8081"},
    {"key": "PW", "label": "Password", "secret": True},
]


def test_missing_answers_take_the_manifest_default():
    """Found live: an API install with `{}` wrote no PORT, and compose published on a
    random host port. The wizard sends defaults pre-filled; an API caller need not."""
    assert manifest.resolve_answers(SPEC, {}) == {"PORT": "8081", "PW": ""}


def test_an_explicit_empty_answer_is_kept():
    """Clearing a pre-filled field is a choice, not a request for the default."""
    assert manifest.resolve_answers(SPEC, {"PORT": ""})["PORT"] == ""


def test_none_counts_as_missing():
    assert manifest.resolve_answers(SPEC, {"PORT": None})["PORT"] == "8081"


def test_a_bare_default_is_empty_not_none():
    """`default:` with no value parses as None, which used to be written as the text "None"."""
    spec = [{"key": "PW", "label": "Password", "default": None}]
    assert manifest.resolve_answers(spec, {}) == {"PW": ""}


def test_answers_are_written_in_manifest_order_as_strings():
    assert list(manifest.resolve_answers(SPEC, {"PW": "x", "PORT": 9000}).items()) == [
        ("PORT", "9000"),
        ("PW", "x"),
    ]


def test_an_undeclared_answer_is_refused():
    with pytest.raises(manifest.RecipeError, match="not declared by this recipe: COMPOSE_PROJECT_NAME"):
        manifest.resolve_answers(SPEC, {"COMPOSE_PROJECT_NAME": "hijacked"})


@pytest.mark.parametrize("key", ["MY VAR", "A=B", "1PORT", "PORT\nX"])
def test_env_key_must_be_a_variable_name(key):
    errors = manifest.validate_manifest(
        {"name": "X", "type": "pull", "env": [{"key": key, "label": "L"}]}
    )
    assert any("not a valid variable name" in e for e in errors)


# --- type: path — the host folders a recipe mounts ---


@pytest.mark.parametrize("value", ["./data", "./library/photos", "../shared", "/srv/media", "/mnt/nas share"])
def test_a_mountable_path_has_no_problem(value):
    assert manifest.path_problem(value) is None


@pytest.mark.parametrize(
    "value,why",
    [
        ("~/media", "/root"),  # compose runs as root inside Loskai's container
        ("~", "/root"),
        ("data", "Docker volume"),  # a bare name is a named volume, not a folder
        ("/srv/a:b", "split the volume spec"),
    ],
)
def test_paths_compose_would_mount_somewhere_else(value, why):
    assert why in manifest.path_problem(value)


PATH_SPEC = [
    {"key": "CONFIG", "label": "Config folder", "type": "path", "default": "./config"},
    {"key": "MEDIA", "label": "Media library", "type": "path"},
]


def test_a_path_answer_is_checked_on_the_server():
    with pytest.raises(manifest.RecipeError, match="Media library.*Docker volume"):
        manifest.resolve_answers(PATH_SPEC, {"MEDIA": "movies"})
    with pytest.raises(manifest.RecipeError, match="/root"):
        manifest.resolve_answers(PATH_SPEC, {"MEDIA": "~/movies"})


def test_a_path_is_required_even_when_cleared():
    """An empty source makes `:/media`, which compose rejects after the folder is made."""
    with pytest.raises(manifest.RecipeError, match="'Media library' is required"):
        manifest.resolve_answers(PATH_SPEC, {})
    with pytest.raises(manifest.RecipeError, match="'Config folder' is required"):
        manifest.resolve_answers(PATH_SPEC, {"CONFIG": "  ", "MEDIA": "/srv/media"})


def test_path_answers_are_trimmed_and_passed_through():
    assert manifest.resolve_answers(PATH_SPEC, {"MEDIA": " /srv/media "}) == {
        "CONFIG": "./config", "MEDIA": "/srv/media",
    }


def test_a_manifest_path_default_is_checked_too():
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "env": [
        {"key": "D", "label": "Data", "type": "path", "default": "~/data"},
    ]})
    assert any("env[0] default" in e and "/root" in e for e in errors)


def test_an_unknown_env_type_is_rejected():
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "env": [
        {"key": "D", "label": "Data", "type": "folder"},
    ]})
    assert any("type must be one of" in e for e in errors)


def test_directories_is_gone_and_says_what_replaces_it():
    errors = manifest.validate_manifest({"name": "X", "type": "pull", "directories": ["/srv/x"]})
    assert any("type: path" in e for e in errors)
