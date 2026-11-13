[Docs](../README.md) › [Contributing](../README.md#contributing)

# Where each decision lives

**Read this when** you are about to write a function that decides something — an address,
a name, a command, whether a request is allowed — or change one that does.

Each decision lives in one function, its **owner**. The worst bugs here were one decision
made twice: two ways to compute an address, two route forms pre-filling a container
differently. So, before writing one:

1. **Find the decision below.** If it is here, call its owner; don't write a second one.
2. **If it isn't, the new function is its owner**: add a row in the same commit, with
   **Used by** left empty, and run `python3 scripts/where-used.py --write` to fill it in.
3. **If the browser and the server both have to decide it**, both rows go in, and a line
   under [Pairs](#pairs-that-must-agree) says what keeps them in step.

Paths are from `backend/src/loskai/` for Python and `frontend/src/` for TypeScript.

**Used by is generated**: `scripts/where-used.py` follows the imports to every file that
uses the owner, besides its own file and the tests. Reading a field the owner fills, such
as `suggested_upstream`, counts. `bash scripts/check-docs.sh` fails while an owner is no
longer defined where its row says, or while **Used by** is out of date — a new caller, a
caller gone. `python3 scripts/where-used.py --write` brings it up to date. For any
function, listed here or not: `python3 scripts/where-used.py <name>`.

What a tool or a recipe does is data, not a function: its contract is
[tool-schema.md](../reference/tool-schema.md) or [recipe-schema.md](../reference/recipe-schema.md).
What a machine's status key may run is [ssh-status.md](../reference/ssh-status.md).

## Records and routes

| Decision | Owner | Used by |
|---|---|---|
| A record by id, or a 404; the base domain a name needs, or a 400 | `shared/instances.py` `require` `require_base` | `modules/adguard/service.py` `modules/caddy/service.py` `modules/docker/router.py` `shared/assign.py` |
| Whether a record is a machine (declared by `kind`) | `shared/instances.py` `is_machine` | `modules/adguard/service.py` `modules/ssh/connect.py` `modules/ssh/router.py` `shared/assign.py` `shared/dashboard.py` |
| The same, in the browser | `components/routing/machine.ts` `isMachine` | `components/routing/MachineDialog.tsx` `components/routing/ServiceTable.tsx` `components/routing/hostOptions.ts` `components/routing/machineServices.ts` `pages/Machines.tsx` `pages/Routing.tsx` |
| Which routes are on a machine: those on its address | `shared/instances.py` `on_address` | `shared/assign.py` |
| The same, in the browser | `components/routing/machine.ts` `machineAt` `routesOn` | `components/routing/MachineTable.tsx` `components/routing/ServiceTable.tsx` `pages/Machines.tsx` `pages/settings/General.tsx` |
| The Docker host's row before it is named | `components/routing/machine.ts` `unnamedDockerHost` | `pages/Machines.tsx` |
| Where a record opens | `shared/instances.py` `open_url` | `modules/caddy/service.py` `modules/docker/router.py` `shared/assign.py` `shared/dashboard.py` |
| Where a record's uploaded icon is served | `shared/instances.py` `icon_url` | `modules/caddy/service.py` `shared/dashboard.py` |
| What a change to the records makes stale, in the browser | `lib/routes.ts` `refreshRecords` | `components/docker/InstallWizard.tsx` `components/routing/useSaveMachine.ts` `components/settings/ClearRewrites.tsx` `pages/Machines.tsx` `pages/Routing.tsx` |
| How that address is shown and opened | `components/shared/RouteLink.tsx` `RouteLink` | `components/docker/InstallWizard.tsx` `components/docker/StackGroups.tsx` `components/routing/MachineTable.tsx` `components/routing/ServiceTable.tsx` |
| Making a route or naming a machine: Caddy, then AdGuard, rolled back on failure | `shared/assign.py` `assign` | only its own file |
| Making a link | `shared/assign.py` `make_link` | only its own file |
| Saving or deleting a machine, and what Loskai put on it with its SSH connection | `shared/assign.py` `save_machine` `purge_instance` | `modules/docker/router.py` |
| Whether an edit may move a record to another container: never | `shared/assign.py` `same_container` | only its own file |
| What a name and an upstream may be (enforced) | `shared/assign.py` `validate_prefix` `validate_upstream` | only its own file |
| The same rules while typing | `lib/validation.ts` `isValidPrefix` `splitUpstream` `assembleFqdn` `pathProblem` | `components/docker/InstallWizard.tsx` `components/docker/StackForm.tsx` `components/routing/AddMachineModal.tsx` `components/routing/MachineDialog.tsx` `components/routing/MachineTable.tsx` `components/routing/machine.ts` `components/routing/useRouteFields.ts` |
| A route form's fields and their checks | `components/routing/useRouteFields.ts` `useRouteFields` | `components/routing/AddRouteModal.tsx` `components/routing/AssignModal.tsx` `components/routing/LinkModal.tsx` |
| What a route form fills in for a container | `components/routing/containerPrefill.ts` `containerPrefill` | `components/docker/InstallWizard.tsx` `components/routing/AddRouteModal.tsx` `pages/Routing.tsx` |
| Whether Caddy is set up: offer routes, or only links | `lib/useHealth.ts` `useCaddySetUp` | `components/docker/InstallWizard.tsx` `components/routing/AddRouteModal.tsx` `components/routing/MachineTable.tsx` `pages/Routing.tsx` |

## Containers

| Decision | Owner | Used by |
|---|---|---|
| A container's upstream, as Caddy reaches it | `modules/docker/logic.py` `suggested_upstream` | `modules/docker/client.py` `shared/follow.py` `components/docker/InstallWizard.tsx` `components/routing/AddRouteModal.tsx` `components/routing/containerPrefill.ts` `lib/containers.ts` `pages/Routing.tsx` |
| A container's address, as the browser reaches it | `modules/docker/logic.py` `published_upstream` | `modules/docker/client.py` `shared/follow.py` `components/docker/InstallWizard.tsx` `components/routing/AddRouteModal.tsx` `lib/containers.ts` `pages/Routing.tsx` |
| A route following its container to a new port | `shared/follow.py` `derive_upstream` `derive_published` | `shared/assign.py` |
| What a generated `.env` says: every value quoted and escaped | `modules/docker/dotenv.py` `render_env` | `modules/docker/recipes.py` `modules/docker/updates.py` |
| Whether a stack takes over a folder with data in it | `modules/docker/stacks.py` `claim_dir` | `modules/docker/recipes.py` |
| A stack by name, or a 404; its `.env` as written | `modules/docker/stacks.py` `require_stack` `env_text` | `modules/docker/stackform.py` `modules/docker/updates.py` |
| Which recipe a stack came from: its install record's, else its folder's name | `modules/docker/recipes.py` `installed_as` `stack_recipe` | `modules/docker/stackform.py` `modules/docker/updates.py` |
| Which recipe sources failed to sync, in a line | `lib/recipes.ts` `syncFailed` | `components/docker/InstallWizard.tsx` `components/settings/RecipeSources.tsx` |
| The recipe list, and its type | `lib/recipes.ts` `useRecipes` | `components/docker/InstallWizard.tsx` `components/settings/RecipeSources.tsx` |
| Saving a stack and bringing it up, from either editor view | `components/docker/useSaveAndUp.ts` `useSaveAndUp` | `components/docker/StackEditor.tsx` `components/docker/StackForm.tsx` |

## Caddy and AdGuard

| Decision | Owner | Used by |
|---|---|---|
| A route's Caddy JSON, and which servers it goes in (`both` is two routes) | `modules/caddy/service.py` `build_route` `wants_https` `wants_http` `expected_route_ids` | only its own file |
| Pushing and removing a route | `modules/caddy/service.py` `upsert_route` `teardown_route` | `shared/assign.py` `shared/follow.py` |
| Which of Caddy's servers is `:443` and which `:80` | `modules/caddy/service.py` `select_server_name` `select_http_server_name` | `modules/caddy/client.py` |
| The address a DNS rewrite answers with | `modules/adguard/service.py` `target_answer` | `shared/assign.py` |
| The rewrite a routed instance should have, and which answers on its name are hand-added | `modules/adguard/service.py` `expected` `foreign` | only its own file |
| Which rewrites to add and remove: Loskai's own, by `(domain, answer)` | `modules/adguard/service.py` `reconcile` `plan_reconcile` `is_loskai_domain` | `modules/adguard/router.py` |

## Access and secrets

| Decision | Owner | Used by |
|---|---|---|
| Whether a request comes from Loskai's own page | `shared/auth.py` `same_origin` | `shared/terminal.py` |
| The level each route needs | `shared/access.py` `rule_for` `allows` | `shared/auth.py` |
| Asking for a password again, with the login backoff | `shared/auth.py` `check_password` | `modules/ssh/router.py` |
| Who may open a terminal WebSocket, and when it closes | `shared/terminal.py` `accept` `relay` | `modules/docker/router.py` `modules/ssh/router.py` |
| Writing a file that holds a secret: owner-only | `shared/store.py` `write_private` `replace_private` | `modules/docker/recipes.py` `modules/docker/stackform.py` `modules/docker/stacks.py` `modules/docker/updates.py` `modules/ssh/client.py` `shared/auth.py` |
| A setting's value: env var, then `settings.json`, then unset | `shared/settings.py` `resolve` `value` | 12 files: `python3 scripts/where-used.py resolve value` |
| Whether Loskai's SSH key is unlocked, and for whom | `modules/ssh/unlock.py` `unlocked_key` | `modules/ssh/connect.py` |

## Machines and tools

| Decision | Owner | Used by |
|---|---|---|
| How a machine is reached over SSH — its `HostName`, else its address — and that login shown | `modules/ssh/connect.py` `reach` | `modules/ssh/router.py` |
| Each machine's trusted host key | `modules/ssh/logic.py` `known_keys` `known_key` | `modules/ssh/connect.py` `modules/ssh/router.py` |
| The status line a machine installs | `modules/ssh/logic.py` `STATUS_COMMAND` `status_line` | `modules/ssh/connect.py` |
| Reading what the status key answered, and which line it came from | `modules/ssh/logic.py` `parse_facts` `parse_running` `line_version` | `modules/ssh/connect.py` |
| Which programs the overview detects | `modules/ssh/logic.py` `PROGRAMS` | `modules/ssh/tool.py` |
| The `PATH` a command runs with: `~/.local/bin` added | `modules/ssh/logic.py` `USER_PATH` | `modules/ssh/connect.py` `modules/ssh/tool.py` |
| What a run looks like on the machine: sudo's password, tmux, `[done]` or `[failed]` | `modules/ssh/tool.py` `visible` | `modules/ssh/connect.py` |
| Which tmux session an action runs in | `modules/ssh/tool.py` `session_name` | `modules/ssh/connect.py` |
| Whose each tmux session is, and which rows' shared sessions are running | `modules/ssh/tool.py` `claim_sessions` | `modules/ssh/connect.py` |
| Whether a target may reach a command as `$1` | `modules/ssh/tool.py` `check_target` | `modules/ssh/connect.py` |
| How a missing program is installed | `modules/ssh/tool.py` `INSTALLERS` `install_script` | `modules/ssh/connect.py` |
| What the sudo rule for updates allows | `modules/ssh/tool.py` `update_commands` `allow_script` | `modules/ssh/connect.py` |
| sudo's password for an automatic run: checked, held for one run | `modules/ssh/connect.py` `prepare` `take_password` | `modules/ssh/router.py` |
| What Tailscale is doing on a machine, and in a few words | `lib/ssh.ts` `tailscaleState` `tailscaleStatus` | `components/routing/MachineOverview.tsx` `components/routing/MachineTools.tsx` `lib/toolRows.ts` |
| What a tool's card lists, and its one-line summary | `lib/toolRows.ts` `toolSummary` `listsOf` `toolContext` | `components/routing/MachineDialog.tsx` `components/routing/MachineTools.tsx` `components/routing/ToolDialog.tsx` |
| An automatic run's terminal: drops down, lingers, stays on a failure | `components/shared/QuickTerminal.tsx` `QuickTerminal` | `components/routing/MachineTerminal.tsx` |

## The page

| Decision | Owner | Used by |
|---|---|---|
| Escape closes the top dialog only | `lib/useEscape.ts` `useEscape` | `components/shared/Modal.tsx` `components/shared/QuickTerminal.tsx` |
| A link from the app to a page of these docs | `lib/docs.ts` `docUrl` | `components/docker/StackGroups.tsx` |

## Pairs that must agree

Each pair is a decision the browser makes again, so a page can answer without asking the
server. Change one side, change the other in the same commit.

| Decision | Server | Browser | What keeps them in step |
|---|---|---|---|
| Whether a record is a machine | `is_machine` | `isMachine` | The server sends `kind`; the browser only reads it. The fallback on the upstream's shape is for rows from before `kind`. |
| Which routes are on a machine | `on_address` | `machineAt`, `routesOn` | The same rule: the upstream's host is the machine's address. Nothing checks they agree. |
| What a name and an upstream may be | `validate_prefix`, `validate_upstream` | `lib/validation.ts` | The server enforces; the browser only says so while typing. A rule only the browser has isn't a rule. |
| Where a route or link will open, shown before it is saved | `open_url` | `useRouteFields`' `opensAt` (the three route forms), and the install wizard's `LinkNow` | Nothing checks they agree: the record doesn't exist until it is saved, so there is nothing to ask the server. A link opens at `http://` or, when its backend speaks HTTPS, `https://` and its address; a route at `https://` and its name, `http://` only when it is HTTP only. Once saved, every row opens at the server's `url`. |
