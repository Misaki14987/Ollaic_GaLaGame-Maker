async function findRelease(github, repo, tag) {
  const matches = (await github.paginate(github.rest.repos.listReleases, {
    ...repo, per_page: 100,
  })).filter((release) => release.tag_name === tag);
  return matches.find((release) => !release.draft) ?? matches[0];
}

async function tagCommit(github, repo, tag) {
  let object;
  try {
    ({ data: { object } } = await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` }));
  } catch (error) {
    if (error.status === 404) return undefined;
    throw error;
  }
  while (object.type === 'tag') {
    ({ data: { object } } = await github.rest.git.getTag({ ...repo, tag_sha: object.sha }));
  }
  if (object.type !== 'commit') throw new Error(`${tag} does not point to a commit`);
  return object.sha;
}

export async function prepareReleaseDraft({ github, repo, tag, sha, release }) {
  if (release === undefined) release = await findRelease(github, repo, tag);
  if (release && !release.draft) return { build: false, release_id: String(release.id) };
  if (release && release.target_commitish !== sha) {
    throw new Error(`Draft ${tag} belongs to ${release.target_commitish}; rerun that commit or increase VERSION`);
  }

  let commit = await tagCommit(github, repo, tag);
  if (!commit) {
    try {
      // Creating the ref atomically reserves this version before creating a draft.
      await github.rest.git.createRef({ ...repo, ref: `refs/tags/${tag}`, sha });
      commit = sha;
    } catch (error) {
      if (error.status !== 422) throw error;
      commit = await tagCommit(github, repo, tag);
      if (!commit) throw error;
    }
  }
  if (commit !== sha) throw new Error(`${tag} already belongs to another commit; increase VERSION`);

  if (!release) {
    ({ data: release } = await github.rest.repos.createRelease({
      ...repo, tag_name: tag, target_commitish: sha,
      name: `Ollaic GaLaGame Maker ${tag}`, draft: true,
      generate_release_notes: true,
    }));
  }
  return { build: true, release_id: String(release.id) };
}
