import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareRelease, prepareReleaseDraft } from './release-draft.mjs';

const repo = { owner: 'fixture', repo: 'fixture' };
const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const tag = 'v0.1.1';
const apiError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

function fixture({ releases = [], ref, tags = {} } = {}) {
  const state = { releases: structuredClone(releases), ref, writes: [] };
  const github = {
    paginate: async () => structuredClone(state.releases),
    rest: {
      repos: {
        listReleases() {},
        createRelease: async (params) => {
          state.writes.push(['release', params]);
          const release = { ...params, id: state.releases.length + 1 };
          state.releases.push(release);
          return { data: structuredClone(release) };
        },
      },
      git: {
        getRef: async () => {
          if (!state.ref) throw apiError(404);
          return { data: { object: structuredClone(state.ref) } };
        },
        getTag: async ({ tag_sha }) => ({ data: { object: tags[tag_sha] } }),
        createRef: async (params) => {
          if (state.ref) throw apiError(422);
          state.writes.push(['tag', params]);
          state.ref = { type: 'commit', sha: params.sha };
          return { data: { object: structuredClone(state.ref) } };
        },
      },
    },
  };
  return { state, github, prepare: (sha = first) => prepareReleaseDraft({ github, repo, tag, sha }) };
}

function history(t) {
  const root = mkdtempSync(join(tmpdir(), 'ollaic-draft-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--initial-branch=master');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release-test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  const commit = (version) => {
    writeFileSync(join(root, 'VERSION'), `${version}\n`);
    git('add', '.');
    git('commit', '-m', `Version ${version}`);
    return git('rev-parse', 'HEAD');
  };
  const before = commit('0.1.0');
  const older = commit('0.1.1');
  commit('0.1.2');
  git('tag', 'v0.1.2');
  return { root, before, older, git };
}

test('reserves a version before creating a draft and leaves it unpublished', async () => {
  const { state, prepare } = fixture();
  assert.deepEqual(await prepare(), { build: true, release_id: '1' });
  assert.deepEqual(state.writes.map(([kind]) => kind), ['tag', 'release']);
  assert.equal(state.ref.sha, first);
  assert.equal(state.releases[0].target_commitish, first);
  assert.equal(state.releases[0].draft, true);
  assert.equal(state.releases[0].generate_release_notes, true);
});

test('a failed draft creation leaves the version reserved for the same commit to retry', async () => {
  const { state, github, prepare } = fixture();
  const createRelease = github.rest.repos.createRelease;
  github.rest.repos.createRelease = async () => { throw apiError(503); };
  await assert.rejects(prepare(), { status: 503 });
  assert.equal(state.ref.sha, first);
  await assert.rejects(prepare(second), /already belongs to another commit/);
  github.rest.repos.createRelease = createRelease;
  assert.equal((await prepare()).build, true);
  assert.equal(state.releases.length, 1);
});

test('rerunning the same commit reuses its draft without replacing release notes or assets', async () => {
  const draft = { id: 42, tag_name: tag, target_commitish: first, draft: true, body: 'Edited notes', assets: ['installer'] };
  const { state, prepare } = fixture({ releases: [draft], ref: { type: 'commit', sha: first } });
  assert.deepEqual(await prepare(), { build: true, release_id: '42' });
  assert.deepEqual(state.releases, [draft]);
  assert.deepEqual(state.writes, []);
});

test('a follow-up commit cannot retarget an existing draft or its tag', async () => {
  const draft = { id: 42, tag_name: tag, target_commitish: first, draft: true };
  const { state, prepare } = fixture({ releases: [draft], ref: { type: 'commit', sha: first } });
  await assert.rejects(prepare(second), /rerun that commit or increase VERSION/);
  assert.equal(state.ref.sha, first);
  assert.deepEqual(state.releases, [draft]);
  assert.deepEqual(state.writes, []);
});

test('concurrent commits competing for an unclaimed version cannot create separate drafts', async () => {
  const { state, prepare } = fixture();
  const results = await Promise.allSettled([prepare(first), prepare(second)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /already belongs to another commit/);
  assert.equal(state.releases.length, 1);
  assert.equal(state.releases[0].target_commitish, state.ref.sha);
  assert.deepEqual(state.writes.map(([kind]) => kind), ['tag', 'release']);
});

test('an existing tag owned by another commit cannot acquire a draft', async () => {
  const { state, prepare } = fixture({ ref: { type: 'commit', sha: second } });
  await assert.rejects(prepare(), /already belongs to another commit/);
  assert.deepEqual(state.writes, []);
});

test('annotated tags are resolved to their commit before permitting a retry', async () => {
  const { prepare } = fixture({
    ref: { type: 'tag', sha: 'outer' },
    tags: { outer: { type: 'tag', sha: 'inner' }, inner: { type: 'commit', sha: first } },
  });
  assert.equal((await prepare()).build, true);
});

test('published releases take precedence over stale drafts and skip all mutations', async () => {
  const { state, prepare } = fixture({ releases: [
    { id: 41, tag_name: tag, target_commitish: second, draft: true },
    { id: 42, tag_name: tag, target_commitish: first, draft: false },
  ] });
  assert.deepEqual(await prepare(second), { build: false, release_id: '42' });
  assert.deepEqual(state.writes, []);
});

test('API failures are not treated as permission to create or move a tag', async () => {
  const { state, github, prepare } = fixture();
  github.rest.git.getRef = async () => { throw apiError(503); };
  await assert.rejects(prepare(), { status: 503 });
  assert.deepEqual(state.writes, []);
});

test('the prepare flow reuses an untagged older draft after a newer version was tagged', async (t) => {
  const { root, before, older, git } = history(t);
  const draft = { id: 42, tag_name: tag, target_commitish: older, draft: true, body: 'Edited notes', assets: ['installer'] };
  const { state, github } = fixture({ releases: [draft] });
  assert.equal(git('tag', '--list', tag), '');
  const result = await prepareRelease({ github, repo, root, before, sha: older });
  assert.deepEqual(result, { tag, build: true, release_id: '42' });
  assert.equal(state.ref.sha, older);
  assert.deepEqual(state.releases, [draft]);
  assert.deepEqual(state.writes.map(([kind]) => kind), ['tag']);
});

test('the prepare flow still rejects creating a new version below an existing tag', async (t) => {
  const { root, before, older } = history(t);
  const { state, github } = fixture();
  await assert.rejects(prepareRelease({ github, repo, root, before, sha: older }), /must be higher than existing tag/);
  assert.deepEqual(state.writes, []);
});

test('the prepare flow skips an already published older version without altering its draft', async (t) => {
  const { root, before, older } = history(t);
  const { state, github } = fixture({ releases: [
    { id: 41, tag_name: tag, target_commitish: older, draft: true },
    { id: 42, tag_name: tag, target_commitish: older, draft: false },
  ] });
  assert.deepEqual(await prepareRelease({ github, repo, root, before, sha: older }), {
    tag, build: false, release_id: '42',
  });
  assert.deepEqual(state.writes, []);
});
