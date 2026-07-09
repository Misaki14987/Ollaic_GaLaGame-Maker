# WebGAL Editor Context

This repository builds a local desktop editor for authoring and exporting WebGAL visual novels.

## Terms

### Project

A local WebGAL work directory containing `game/`, its configuration, scenes, and assets.

### Scene

A WebGAL `.txt` script in `game/scene/`. A scene is edited visually as an ordered collection of nodes and exported as script text.

### Scene Editing

The authoring behaviour for a scene: inserting, removing, reordering, connecting, saving, restoring drafts, and adding generated nodes. Sequential connections stop at terminal nodes.

### Asset

A media file owned by a project and stored in an appropriate `game/` category directory, such as `background`, `figure`, `bgm`, `sfx`, `vocal`, or `video`.

### Asset Reference

A semantic reference from a Scene command to an Asset file. It is discovered from parsed Scene meaning rather than arbitrary text matches, and follows its Asset when the Asset is renamed.

### Asset Metadata

Editor-managed information associated with an Asset, including its display alias, tags, and Reference Material index. It is stored with the Project and identified by Asset category and filename. Metadata follows the Asset when it is renamed and is removed when the Asset is deleted.

### Reference Material

Supplemental source media associated with an asset for creation workflows. It is stored below `game/config/references/` and follows the owning asset lifecycle.

### Character

A person authored for a Project, with stable identity, dialogue context, relationships, and figure sprite mappings. Character reads expose one canonical entry per identity.

### Agent Flow

A user-visible generation plan made of dependent Steps that moves a Project toward a playable WebGAL result. It represents creative work in progress, not the exported game itself.
_Avoid_: Pipeline, DAG, workflow

### FlowBoard

The project-first visual workspace for starting, inspecting, pausing, retrying, and navigating an Agent Flow. It is the first project screen in V2 and links into Scene Editing, asset management, and Character editing rather than replacing them.
_Avoid_: ProjectHome replacement, Pipeline UI

### Flow Step

A user-visible unit of work inside an Agent Flow, such as planning, outlining, writing a scene, producing assets, reviewing, or exporting. A Flow Step is distinct from a Scene node.
_Avoid_: Flow node, pipeline task

### StoryPlan

A project-owned planning record for an Agent Flow, containing the prompt, story outline, generation context, step outputs, and run history. It explains and resumes generation work; the playable story remains in the Project's WebGAL files.
_Avoid_: Source of truth, project database

### Run to Playable

An Agent Flow mode that allows approved write Steps to update the Project automatically on the way to a playable build. It is distinct from planning mode, where generated work remains staged until the user applies it.
_Avoid_: Auto mode, one-click run

### Staged Output

Generated story, scene, asset, or review output that has not yet been applied to the Project's playable files. It can be inspected, retried, edited, or applied through the FlowBoard.
_Avoid_: Draft, pending change

### Stale Flow Step

A previously completed Flow Step whose upstream input has changed since it last ran. Its output remains inspectable, but the FlowBoard must not present it as current.
_Avoid_: Invalid node, dirty task

### Flow Dependency

A prerequisite relationship between Flow Steps that controls run order, input freshness, and stale propagation. In V2, users may edit dependencies for pending work before it runs.
_Avoid_: Edge, link, connector

### Flow Template

A reusable production recipe that defines Flow Steps, dependencies, default prompts, configurable inputs, and expert settings for future Projects or runs. It is not a playable story, a WebGAL runtime theme, or a Project skeleton.
_Avoid_: Workflow preset, project template, DAG preset, WebGAL template

### Production Studio

The V2 product shape for Ollaic: a local workspace for producing WebGAL visual novels through reusable Agent Flows, generated content, quality checks, playable previews, and manual refinement. Scene Editing and asset management support production work, but the primary user mental model is not a traditional IDE.
_Avoid_: IDE, copilot, script editor

### Studio Complete

The target maturity of a Project in V2: not only generated enough to play, but maintainable through repeated Agent Flow runs, template reuse, asset replacement, review repair, quality gates, preview, and export candidate preparation.
_Avoid_: MVP complete, playable demo

### Production Brief

The user's natural-language description of the work they want to produce, including subject, style, scope, language, characters, and constraints. It is the starting point for choosing or configuring a Flow Template.
_Avoid_: Prompt, project description, task

### Template Match

The selected Flow Template and configuration proposed for a Production Brief, including the rationale for why it fits. A Template Match can be reviewed, replaced, edited, and then run as an Agent Flow.
_Avoid_: Auto template, recommendation

### Template Parameter

A user-facing choice that configures a Flow Template before it becomes an Agent Flow, such as story length, language, heroine count, asset coverage, voice coverage, or ending structure.
_Avoid_: Form field, prompt variable

### Story Subject

The setting, motif, or aesthetic direction of a visual novel, such as campus, cyberpunk, fantasy, historical, or post-apocalyptic. It usually configures a Flow Template rather than determining the production workflow by itself.
_Avoid_: Genre, type, theme

### Production Type

The narrative or delivery pattern that shapes how a visual novel should be produced, such as romance routes, mystery, multi-ending, playable demo, or long-form commercial work. It can select, extend, or specialize a Flow Template.
_Avoid_: Genre, topic

### Flow Module

A reusable extension that adds specialized Steps, checks, parameters, or dependencies to a Flow Template for a secondary Production Type. It can be built in, user-authored, imported, or shared, and modifies a production recipe without replacing its primary shape.
_Avoid_: Plugin, subtemplate, template merge

### Declarative Recipe

A Flow Template or Flow Module that describes production structure, prompts, schemas, parameters, dependencies, and checks without executing arbitrary code. It is the default format for reusable Agent Flow recipes.
_Avoid_: Plugin, script, extension

### Model Capability

A model-independent requirement declared by a Flow Step, such as long context, structured output reliability, low cost, image generation, TTS, or strong reasoning. User provider settings map these capabilities to concrete models.
_Avoid_: Model name, provider setting

### Capability Gap

A missing or weak local provider mapping for a Model Capability required by a Template Match. It must be visible before an Agent Flow runs so the user can configure a provider, accept a downgrade, or disable affected Flow Modules.
_Avoid_: Missing model, provider error

### Downgraded Flow Step

A Flow Step that ran with a weaker provider capability than its recipe requested. Its output can be usable, but the FlowBoard must show the downgrade instead of presenting the Step as fully trusted.
_Avoid_: Fallback result, weak success

### Quality Gate

A Flow Step that decides whether generated Project output is safe enough to continue, preview, or export. Critical Quality Gates cannot be satisfied by downgraded capability results.
_Avoid_: Review, lint, check

### Playability Level

The trust level of a Project's playable output after an Agent Flow run: Draft Playable for rough local preview, Review Playable for a complete review path, and Release Candidate for export-ready output.
_Avoid_: Success status, build status

### Flow Impact

The set of Flow Steps and Playability checks affected by a change to Project content. When exact impact cannot be determined, the FlowBoard must conservatively invalidate broader downstream checks.
_Avoid_: Dirty scope, dependency impact

### Flow Lock

A temporary edit restriction on Project content actively being read or written by a running Flow Step. It protects the running Step without making the whole Project read-only.
_Avoid_: Global lock, file lock

### Step Run History

The retained record of each Flow Step attempt, including input snapshot, output reference, diff, cost, duration, warning state, and failure summary. Large artifacts are referenced rather than duplicated.
_Avoid_: Log, trace, output cache

### Pinned Run

A Flow run or Step attempt protected from automatic cleanup because the user wants to preserve it for comparison, audit, reuse, or export.
_Avoid_: Favorite run, saved log

### Flow Artifact

A generated or captured output owned by an Agent Flow run rather than the Project's formal asset library or playable files. It can be inspected, cleaned up, or promoted into the Project when useful.
_Avoid_: Temporary asset, cache file

### Promoted Asset

A Flow Artifact accepted into the Project's formal asset library and therefore treated as normal Project content with metadata, references, usages, and cleanup rules.
_Avoid_: Saved artifact, accepted media

### Asset Coverage

The amount and quality of media the Agent Flow should produce and bind for a Project, such as placeholder-only, key assets, main cast coverage, full background coverage, or full voice coverage.
_Avoid_: Asset completeness, media quality

### Primary Play Path

The main route or review target through a Project that must meet the strongest playability and asset coverage expectations for a given run. Secondary or low-priority paths may be allowed lower coverage when clearly marked.
_Avoid_: Happy path, main branch

### Release Scope

The set of routes, endings, chapters, or scenes that must satisfy Release Candidate Quality Gates for a given production target. It may be one primary ending, all endings, or a user-selected subset.
_Avoid_: Export scope, test scope

### Scoped Export

An export that includes only the Project content required for a selected Release Scope, after validating that references remain safe. Full export remains available.
_Avoid_: Partial export, demo export

### Narrative Quality

The production-level standard for generated story text, covering readability, character voice, style consistency, terminology, pacing, foreshadowing, branch motivation, emotional curve, and player choice feedback.
_Avoid_: Text quality, writing quality

### Stale Asset

A Project asset whose existing binding may no longer match changed story, scene, character, or voice context. It remains in the Project until reused, rebound, regenerated, or removed by the user.
_Avoid_: Invalid asset, orphan media

### Asset Consistency Task

A suggested regeneration, rebinding, or review task created when related Project assets may no longer share the intended style, character design, voice, or narrative context.
_Avoid_: Batch regenerate, consistency fix

### Creator Preference

A user-level or project-level preference that influences future Agent Flows, such as writing style, pacing, visual style, voice direction, or common rejection patterns. It must be visible and editable.
_Avoid_: Hidden memory, personalization

### Local-First Project

A Project whose playable files, assets, Flow history, AI settings, preferences, and generated artifacts are primarily stored and controlled on the user's machine. Cloud services may assist with optional sync or sharing, but they do not own the Project.
_Avoid_: Cloud project, hosted workspace

### Project Flow

An Agent Flow run that acts on one Project as its single playable content boundary. Batch production may coordinate multiple Project Flows, but one Project Flow does not own multiple Projects.
_Avoid_: Batch flow, multi-project flow

### Target Engine

The visual novel runtime or export format a Project is produced for. WebGAL is the first and primary Target Engine, while V2 keeps production concepts from being unnecessarily WebGAL-only.
_Avoid_: Runtime, platform

### Flow Cost

The estimated and actual provider usage cost for an Agent Flow, Flow Step, or Playability promotion. It is displayed for transparency rather than used as a default execution gate.
_Avoid_: Budget, quota

### Content Rating

A declaration on a Flow Template, Flow Module, or Production Brief that describes sensitive content expectations such as adult themes, violence, horror, or provider policy risk. It informs the user before running without turning Ollaic into a publishing platform reviewer.
_Avoid_: Moderation, censorship, platform approval

### Localization Module

A Flow Module that turns an existing primary-language Project into one or more target-language variants, including translation, terminology consistency, and language-specific review.
_Avoid_: Language setting, translation prompt

### Review Note

A local annotation, comment, or task attached to generated Project content, a Flow Step, or a Quality Report item for later human review. It is not a multiplayer collaboration primitive.
_Avoid_: Collaboration comment, issue

### Blocking Review Note

A Review Note marked severe enough to prevent a Project from becoming a Release Candidate until it is resolved or explicitly downgraded.
_Avoid_: Critical comment, release issue

### Review Patch

A proposed repair generated from a review finding that can be previewed, applied, rejected, or automatically applied when the Agent Flow is allowed to perform low-risk fixes.
_Avoid_: Auto fix, reviewer change

### Auto-Fix Policy

A rule set that decides which Review Patches may apply automatically. System safety limits define the maximum allowed scope, while Flow Templates or Flow Modules may choose stricter behavior within that boundary.
_Avoid_: Auto apply setting, repair mode
### Flow Marketplace

A future catalog for discovering, installing, updating, and sharing Flow Templates and Flow Modules after local creation, import, export, and reuse have proven useful. It distributes production recipes for Agent Flows, not executable application plugins or playable game content.
_Avoid_: Plugin store, asset market, game marketplace
