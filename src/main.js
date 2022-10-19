import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';
import * as github from '@actions/github'

import integrationMerge from './integration-merge.js'


async function main() {
  try {

    core.info('Started');

    // inputs
    const repository = core.getInput('repository') || `${github.context.repo.owner}/${github.context.repo.repo}`;
    const [owner, repo] = repository.split('/')

    const integrationBranch = core.getInput('integration_branch') || "stage";
    const approveLabel = core.getInput('approve_label') || "Approved";
    const integratedLabel = core.getInput('integrated_label') || "Integrated";

    const token = core.getInput('github_token', {required: true});


    // execute merge
    const octokit = new Octokit({ auth: `token ${token}` });

    let result = await integrationMerge({ octokit, token, integrationBranch, approveLabel, integratedLabel, owner, repo })

    // set output
    core.info(`set output haveUpdates: ${result ? 'yes' : 'no'}`)
    core.setOutput("haveUpdates", result ? 'yes' : 'no');

  } catch (error) {
    core.setFailed(error.message);
  }
}

export default main;
