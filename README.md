# dsh-skills-manager

A tree-external DeepSeek Harness plugin for managing reusable Agent Skills.

It adds a **Skill 管理** item to the Web Settings sidebar and a wrench control beside the composer attachment button. Skills are copied into a private Harness library, then enabled independently at two scopes:

- **Global**: available from every workspace.
- **Project**: available from one registered workspace and its child directories.

An imported skill is disabled by default. The plugin uses the official `ctx.skills` provider seam, so model-facing discovery and `/skill` loading keep the normal Harness behavior.

## Install

Build a tarball or install the package from a trusted source:

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
4. Choose **检查更新** to compare installed content with local sources or freshly cloned repositories. Use the refresh icon on a row to install a detected change.
5. Use the wrench control beside the composer attachment button to toggle installed skills for the current session workspace only.
6. Remove an installed skill with **移除**. This deletes only the plugin's copied library entry, not the local source or remote repository.

Repository imports discover a root `SKILL.md`, immediate entries under `skills/`, and immediate entries under `.agents/skills/`. Private repositories use the machine's existing Git credential helper or SSH configuration. Do not put credentials in repository URLs; the plugin stores the repository URL and skill subpath, never a token.

Updates preserve global and project enablement. Imports created by older plugin versions have no recorded source; their first update asks for a local source directory and tracks it for later checks.

The imported format follows the official filesystem provider: directory bundles use `<name>/SKILL.md`; flat skills use `<name>.md`. YAML frontmatter must contain a kebab-case `name` and non-empty `description`. Companion resources are copied with directory bundles.

## Storage

By default the plugin uses the actual Harness home resolved from `DSH_HOME`:

```text
$DSH_HOME/skill-manager/library/
$DSH_HOME/skill-manager/state.json
```

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

The test suite covers scope resolution, path containment, local updates, Git clone/update behavior, credential URL rejection, and cleanup of persisted references. `pnpm validate` checks the DSH bundle shape.

## Design boundaries

- This plugin does not call or shell out to the `skills` CLI. Git repositories are fetched with `git clone --depth 1` using an argv array, never through a shell.
- It does not rewrite an imported `SKILL.md` and does not alter the source folder or repository. Skill symlinks that escape their source root are rejected.
- Skills already present in other filesystem roots remain owned by those roots; import them into this library when they should be managed here.
- Import and mutation RPCs are loopback-only because they write local files.
- DSH is in developer preview; bundle and Cordis APIs can change between Harness releases.

## License

`UNLICENSED` until the repository owner chooses an open-source license.
