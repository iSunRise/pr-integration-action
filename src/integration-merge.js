import * as core from '@actions/core';
import fse from 'fs-extra';

import { tmpdir } from './common.js';
import git from './git.js';
import ConflictsResolution from './conflicts-resolution/conflicts-resolution.js';


// limit the number of integrated PRs
const MAX_PR_COUNT = 25;


async function integrationMerge({octokit, gitToken, masterBranch, integrationBranch, approveLabel, integratedLabel, owner, repo, conflictsResolutionRulesFilePath}) {

  // git clone {repo}
  // git checkout {integrationBranch}
  // git reset --hard masterBranch
  // each PR{i}
  //   git fetch origin pulls\{id}\head:pr{i}
  //   git merge --squash pr{i}
  //   git commit -m 'PR {title} {i}'
  // git push -f origin integrationBranch:integrationBranch

  core.info("Reading PRs list");

  const { data: openRequests } = await octokit.pulls.list({
    owner: owner,
    repo: repo,
    state: "open",
    sort: "created",
    direction: "asc",
    per_page: MAX_PR_COUNT
  });
  core.info(`Got ${openRequests.length} PRs`);

  // filter PRs by label
  let pullRequests = openRequests.filter(pr => !skipPullRequest(approveLabel, pr))
  if (pullRequests.length > 0) {
    core.info(`Found open PRs: ${pullRequests.length}`);
  } else {
    core.info("No open PRs.");
    return false;
  }

  return await tmpdir(async path => {
    core.info(`Cloning '${masterBranch}' into ${path}`);
    const url = `https://x-access-token:${gitToken}@github.com/${owner}/${repo}.git`;
    await git.clone(url, path, masterBranch);

    // line below can be used for local testing, it will skip main repo checkout...
    // to use local setup - comment git.clone above, and uncomment line below
    // await git.checkout(path, masterBranch);

    if (await arePrsAlreadyIntegrated(pullRequests, path, masterBranch, integrationBranch)) {
      core.info("All PRs already integrated.");
      return false;
    }

    core.info(`Reset integration branch '${integrationBranch}' to '${masterBranch}'`);
    await git.createBranch(path, integrationBranch, masterBranch, true);

    core.info(`Checkout integration branch '${integrationBranch}'`);
    await git.checkout(path, integrationBranch);

    const rulesPath = conflictsResolutionRulesFilePath ? `${path}/${conflictsResolutionRulesFilePath}`.replace("//", "/") : null;
    const conflictsResolution = new ConflictsResolution(rulesPath);

    let mergedPrs = [];
    let failedPrs = [];
    for (const pullRequest of pullRequests) {
      try {
        const prNumber = pullRequest.number;
        const prBranch = `pr${prNumber}`;
        // add PR's short SHA to commit message to control whether PR was updated since last merge
        const prSha = pullRequest.head.sha.substring(0, 7);
        const commitMessage = `${pullRequest.title} (#${prNumber}) (sha:${prSha})`;
        core.info(`Processing PR ${commitMessage}`);

        core.info(`    fetching ${prNumber} ...`);
        await git.fetchPr(path, prNumber, prBranch);

        core.info(`    merging ${prNumber} ...`);
        try {
          await git.squashMerge(path, prBranch);
        } catch (e) {
          // merge conflicts handling
          core.info("     ! merge error");
          let files = await git.listMergeConflicts(path);
          core.info(`       conflicting files: ${files}`);

          let resolved = true
          for (const file of files) {
            if (!await conflictsResolution.resolveConflict(git, path, file)) {
              // there are more conflicts then we can solve...
              // rollback merge and proceed with next PR
              core.info(`     ! PR ${prNumber} merge failed. Skipping.`);
              await git.reset(path);
              failedPrs.push(pullRequest);
              resolved = false;
              break;
            }
          }

          // skip this PR merge
          if (!resolved) continue;
        }

        await git.commit(path, commitMessage);
        mergedPrs.push(pullRequest);
      } catch (e) {
        core.error(e);
      }
    }

    if (mergedPrs.length === 0) {
      core.info(`No PRs merged....`);
      return false;
    }

    core.info('add integrated PRs titles to integrated.txt');
    await logIntegrationData(git, path, mergedPrs)

    core.info(`Push integration branch ${integrationBranch}`);
    await git.push(path, true, integrationBranch, integrationBranch);

    // clear labels from not merged PRs and set labels to merged ones
    await updateIntegratedLabels({octokit, integratedRequests: mergedPrs, allRequests: openRequests, integratedLabel, repo, owner});

    core.info('Integration merge complete');
    return true;
  });
}


function skipPullRequest(approveLabel, pullRequest) {
  let skip = false;

  if (pullRequest.state !== "open") {
    core.info(`Skipping PR ${pullRequest.number}, state is not open: ${pullRequest.state}`);
    skip = true;
  }

  if (pullRequest.merged === true) {
    core.info(`Skipping PR ${pullRequest.number}, already merged!`);
    skip = true;
  }

  const labels = pullRequest.labels.map(label => label.name);

  if (!labels.includes(approveLabel)) {
    core.info(`Skipping PR ${pullRequest.number}, required label '${approveLabel}' missing`);
    skip = true;
  }

  return skip;
}


async function arePrsAlreadyIntegrated(pullRequests, gitPath, masterBranch, integrationBranch) {

  const fullBranch = `origin/${integrationBranch}`;

  if (!(await git.isBranchExists(gitPath, fullBranch))) {
    core.info(`Integration branch doesn't exists.`);
    return false;
  }

  // test that master is the same - check if integration branch spawned from it's HEAD
  if (await git.commitsToMasterHead(gitPath, masterBranch, fullBranch) !== 0) {
    core.info(`'${masterBranch}' has updates, need to rebuild integration branch.`);
    return false;
  }

  // collect SHAs from PRs pr.head.sha.substring(0, 7);
  // get num of PRs latest commits from the integration branch
  // collect SHAs from commit messages "message (sha: 1234567)"
  // compare arrays if == return true.

  const prShas = pullRequests.map(pr => pr.head.sha.substring(0, 7));

  const mergedPrsMessages = await git.listBranchCommitMessages(gitPath, fullBranch, pullRequests.length);
  const shaRegexp = /\(sha\:(?<sha>.{7})/gm; // get value from strings like: " some text (sha:XXXXXXX)"
  const mergedShas = Array.from(mergedPrsMessages.matchAll(shaRegexp), m => m[1]);

  const allPrsMerged = prShas.length === mergedShas.length && prShas.every(sha => mergedShas.includes(sha));
  return allPrsMerged;
}


async function logIntegrationData(git, path, pullRequests) {
  // add file with all the PR titles
  const titles = pullRequests.map(pr => `${pr.title} (#${pr.number})`).join("\n");
  await fse.writeFile(path + '/integrated_prs.txt', titles, 'utf8');
  await git.addFile(path, 'integrated_prs.txt');

  await writeIntegrationVersion(path);
  await git.commit(path, 'PR integration notes');
}


async function writeIntegrationVersion(path) {

  const jsVersionPath = `${path}/package.json`;
  if (await fse.pathExists(jsVersionPath)) {
    // JS project version
    // we use 'stage.0.1234567890123' format, with timestamp at the end
    // this allow us to not to fight with browser caching
    const timestamp = Date.now();
    const version = `"version": "stage.0.${timestamp}",`;
    core.info(`Updating package.json version ${version}`);

    const content = await fse.readFile(jsVersionPath, 'utf8');
    let result = content.replace(/"version":.*/g, version);
    await fse.writeFile(jsVersionPath, result, 'utf8');
    await git.addFile(path, jsVersionPath);
  }
  else {
    core.info('Version files not updated');
  }
}


async function updateIntegratedLabels({octokit, integratedRequests, allRequests, integratedLabel, repo, owner}) {
  core.info("Update Integrated labels");

  // remove IntegratedLabel for allRequests that's not in integratedRequests
  const nonIntegratedPrs = allRequests.filter(pr => !integratedRequests.includes(pr));
  for (const pullRequest of nonIntegratedPrs) {
    try {
      await octokit.issues.removeLabel({ owner, repo, issue_number: pullRequest.number, name: integratedLabel});
    }
    catch (e) {
      // it fails when there is no label
      core.debug(e);
    }
  }

  // add IntegratedLabel for allRequests that are in integratedRequests
  for (const pullRequest of integratedRequests) {
    await octokit.issues.addLabels({ owner, repo, issue_number: pullRequest.number, labels: [integratedLabel]});
  }
}


export default integrationMerge;
