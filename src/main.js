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

    const masterBranch = core.getInput('master_branch') || "master";
    const integrationBranch = core.getInput('integration_branch') || "stage";
    const approveLabel = core.getInput('approve_label') || "Approved";
    const integratedLabel = core.getInput('integrated_label') || "Integrated";

    const token = core.getInput('github_token', {required: true});

    // optional personal access github token with workflow scope
    // allows to merge PRs containing changes in github workflow files
    // see https://docs.github.com/en/developers/apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes
    // https://docs.github.com/en/actions/security-guides/automatic-token-authentication#granting-additional-permissions
    // personal access token can't be used for all action's operations since it will re-trigger workflows
    // and create a workflow cycles
    // e.g. setting label on PR will trigger "labeled" event and in its turn will re-trigger workflow
    // default GITHUB_TOKEN is a special one, and does not trigger workflows
    const tokenWithWorkflowScope = core.getInput('token_with_workflow_scope');

    // optional, specifies path to the file with conflicts resolution rules (see )
    const conflictsResolutionRulesFilePath = core.getInput('conflicts_resolution_rules_file_path') ||
                                             './github/settings/pr-integration-action-conflicts-resolution-rules.yml';

    // execute merge
    const octokit = new Octokit({ auth: `token ${token}` });

    let result = await integrationMerge({ octokit, gitToken: tokenWithWorkflowScope || token, masterBranch,
                                          integrationBranch, approveLabel, integratedLabel, owner, repo,
                                          conflictsResolutionRulesFilePath });

    // set output
    core.info(`set output haveUpdates: ${result ? 'yes' : 'no'}`)
    core.setOutput("haveUpdates", result ? 'yes' : 'no');

  } catch (error) {
    core.setFailed(error.message);
  }
}

export default main;
