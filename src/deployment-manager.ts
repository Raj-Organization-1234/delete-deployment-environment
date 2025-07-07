import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { isAxiosError } from 'axios';

interface DeploymentInfo {
  id: number;
  ref: string;
}

interface RepositoryContext {
  owner: string;
  repo: string;
}

async function validateSubscription(): Promise<void> {
  const API_URL = `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/subscription`

  try {
    await axios.get(API_URL, { timeout: 3000 })
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      core.error(
        'Subscription is not valid. Reach out to support@stepsecurity.io'
      )
      process.exit(1)
    } else {
      core.info('Timeout or API not reachable. Continuing to next step.')
    }
  }
}


export async function run(): Promise<void> {
  try {
    await validateSubscription()
    // Get inputs from action.yml
    const token = core.getInput('token', { required: true });
    const environment = core.getInput('environment', { required: true });
    const targetRef = core.getInput('ref', { required: false });
    const onlyRemoveDeployments = core.getInput('onlyRemoveDeployments', { required: false }) === 'true';
    const onlyDeactivateDeployments = core.getInput('onlyDeactivateDeployments', { required: false }) === 'true';

    // Determine what operations to perform
    const shouldDeleteDeployments = !onlyDeactivateDeployments;
    const shouldDeleteEnvironment = !onlyRemoveDeployments && !onlyDeactivateDeployments;

    // Initialize GitHub client
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    core.info(`Starting deployment management for environment: ${environment}`);

    // Fetch all deployments for the environment
    const deployments = await fetchDeployments(octokit, { owner, repo }, environment, targetRef);
    
    if (deployments.length === 0) {
      core.info('No deployments found for the specified environment');
      return;
    }

    core.info(`Found ${deployments.length} deployment(s) to process`);

    // Deactivate all deployments
    await deactivateDeployments(octokit, { owner, repo }, deployments);

    // Delete deployments if requested
    if (shouldDeleteDeployments) {
      await deleteDeployments(octokit, { owner, repo }, deployments);
    }

    // Delete environment if requested
    if (shouldDeleteEnvironment) {
      await deleteEnvironment(octokit, { owner, repo }, environment);
    }

    core.info('Action completed successfully');
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchDeployments(
  octokit: ReturnType<typeof github.getOctokit>,
  repoContext: RepositoryContext,
  environment: string,
  targetRef?: string
): Promise<DeploymentInfo[]> {
  const deployments: DeploymentInfo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.rest.repos.listDeployments({
      owner: repoContext.owner,
      repo: repoContext.repo,
      environment,
      ref: targetRef || undefined,
      per_page: perPage,
      page
    });

    const pageDeployments = response.data.map(deployment => ({
      id: deployment.id,
      ref: deployment.ref
    }));

    deployments.push(...pageDeployments);

    if (pageDeployments.length < perPage) {
      break;
    }
    page++;
  }

  return deployments;
}

async function deactivateDeployments(
  octokit: ReturnType<typeof github.getOctokit>,
  repoContext: RepositoryContext,
  deployments: DeploymentInfo[]
): Promise<void> {
  core.info('Deactivating deployments...');
  
  const promises = deployments.map(deployment =>
    octokit.rest.repos.createDeploymentStatus({
      owner: repoContext.owner,
      repo: repoContext.repo,
      deployment_id: deployment.id,
      state: 'inactive'
    })
  );

  await Promise.all(promises);
  core.info(`Successfully deactivated ${deployments.length} deployment(s)`);
}

async function deleteDeployments(
  octokit: ReturnType<typeof github.getOctokit>,
  repoContext: RepositoryContext,
  deployments: DeploymentInfo[]
): Promise<void> {
  core.info('Deleting deployments...');
  
  const promises = deployments.map(deployment =>
    octokit.rest.repos.deleteDeployment({
      owner: repoContext.owner,
      repo: repoContext.repo,
      deployment_id: deployment.id
    })
  );

  await Promise.all(promises);
  core.info(`Successfully deleted ${deployments.length} deployment(s)`);
}

async function deleteEnvironment(
  octokit: ReturnType<typeof github.getOctokit>,
  repoContext: RepositoryContext,
  environment: string
): Promise<void> {
  try {
    // Check if environment exists
    await octokit.rest.repos.getEnvironment({
      owner: repoContext.owner,
      repo: repoContext.repo,
      environment_name: environment
    });

    // Delete the environment
    core.info(`Deleting environment: ${environment}`);
    await octokit.rest.repos.deleteAnEnvironment({
      owner: repoContext.owner,
      repo: repoContext.repo,
      environment_name: environment
    });
    
    core.info(`Successfully deleted environment: ${environment}`);
  } catch (error: any) {
    if (error.status === 404) {
      core.info(`Environment ${environment} not found, skipping deletion`);
    } else {
      throw error;
    }
  }
}