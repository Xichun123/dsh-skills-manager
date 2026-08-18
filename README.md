# dsh-skills-manager

A tree-external DeepSeek Harness plugin for managing reusable Agent Skills.

It adds a **Skill 管理** item to the Web Settings sidebar and a wrench control beside the composer attachment button. Skills are installed into a private Harness library, then enabled independently at two scopes:

- **Global**: available from every workspace.
- **Project**: available from one registered workspace and its child directories.

An imported skill is disabled by default. The plugin uses the official `ctx.skills` provider seam, so model-facing discovery and `/skill` loading keep the normal Harness behavior.

## Install

The bundled `skills` CLI requires Node.js 22.20.0 or newer. Build a tarball or install the package from a trusted source:

```sh
pnpm install
pnpm build
pnpm dsh plugin --profile web add .
```

For source development, use the included absolute-path patch after updating the path if needed:

```sh
pnpm dsh web --patch ./cordis.dev.yml
```

After changing the bundle or installed dependencies, restart the Harness service. The browser half is discovered from the package `dsh.client` declaration.

## Use

1. Open Web Settings, then select **Skill 管理** in the sidebar.
2. Choose **本机** to select a local skill folder, or **仓库** to enter a GitHub `owner/repo`, HTTPS URL, SSH URL, or other Git URL.
3. Enable **全局** or select a workspace and enable **项目**.
4. Use the refresh icon on a row to reinstall that skill from the source recorded in `skills-lock.json`.
5. Use the wrench control beside the composer attachment button to toggle installed skills for the current session workspace only.
6. Remove an installed skill with **移除**. This deletes only the plugin's private library entry, not the local source or remote repository.

Repository imports and refreshes are delegated to the `skills` CLI. It supports GitHub `owner/repo`, HTTPS, SSH, Git and file URLs, and reuses the machine's existing Git credential helper or SSH configuration. Do not put credentials in repository URLs; the plugin rejects embedded credentials before invoking the CLI.

Updates preserve global and project enablement. New imports and refreshes require standard directory bundles: `<name>/SKILL.md` with kebab-case `name` and non-empty `description`. Flat `<name>.md` imports are not supported.

## Storage

By default the plugin uses the actual Harness home resolved from `DSH_HOME`:

```text
$DSH_HOME/skill-manager/.agents/skills/
$DSH_HOME/skill-manager/skills-lock.json
$DSH_HOME/skill-manager/state.json
```

`skills-lock.json` is the only source-of-origin record. `state.json` stores only global and project enablement.

Override the storage root in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-skills-manager
      name: dsh-skills-manager
      config:
        storageDir: /absolute/path/to/skill-manager
```

## Development

```sh
pnpm install
pnpm test
pnpm validate
```

The test suite covers scope resolution, current-state validation, local and Git refreshes through the private CLI library, flat-format rejection, credential URL rejection, and removal cleanup. `pnpm validate` checks the DSH bundle shape.

## Design boundaries

- This plugin runs the packaged `skills` CLI with an argv array and a private storage `cwd`; it never modifies the active workspace's `.agents/skills` directory.
- It does not rewrite an imported `SKILL.md` or alter the source folder or repository. Broken or escaping source symlinks are rejected before the CLI copies anything.
- Skills already present in other filesystem roots remain owned by those roots; import them into this private library when they should be managed here.
- Import and mutation RPCs are loopback-only because they write local files.
- DSH is in developer preview; bundle and Cordis APIs can change between Harness releases.

## License

`UNLICENSED` until the repository owner chooses an open-source license.
