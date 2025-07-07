import anyTest, { TestFn } from 'ava';
import * as github from '@actions/github';
import { Octokit } from '@octokit/core';
import { run } from '../src/deployment-manager';
import { RequestError } from '@octokit/request-error';
import nock from 'nock';

const test = anyTest as TestFn<{
  token: string;
  ref: string;
  octokit: Octokit;
  repo: { owner: string; repo: string };
}>;

interface Context {
  owner: string;
  repo: string;
  ref?: string;
}

async function createEnvironment(
  octokit: Octokit,
  environmentName: string,
  { owner, repo }: Context,
): Promise<void> {
  await octokit.request(
    'PUT /repos/{owner}/{repo}/environments/{environment_name}',
    {
      owner,
      repo,
      environment_name: environmentName,
    },
  );
}

async function createDeploymentWithStatus(
  octokit: Octokit,
  environment: string,
  { owner, repo, ref = 'main' }: Context,
): Promise<void> {
  await octokit.request('POST /repos/{owner}/{repo}/deployments', {
    owner,
    repo,
    ref,
    environment,
    required_contexts: [],
  });
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/deployments',
    {
      owner,
      repo,
      environment,
    },
  );
  const [deployment] = data;
  const { id } = deployment;
  await octokit.request(
    'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
    {
      owner: owner,
      repo: repo,
      state: 'success',
      deployment_id: id,
    },
  );
}

async function getDeployments(
  octokit: Octokit,
  environment: string,
  { owner, repo }: Context,
): Promise<{ deploymentId: number; ref: string }[]> {
  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/deployments',
    {
      owner,
      repo,
      environment,
    },
  );
  const deploymentRefs: { deploymentId: number; ref: string }[] = data.map((deployment) => ({
    deploymentId: deployment.id,
    ref: deployment.ref,
  }));
  return deploymentRefs;
}

test.beforeEach((t) => {
  process.env.GITHUB_REPOSITORY = `${
    // set owner to enable test on forked repositories
    process.env.OWNER || 'step-security'
  }/delete-deployment-environment`;
  process.env.GITHUB_REF = 'main';
  github.context.ref = process.env.GITHUB_REF;
  const { GITHUB_TOKEN = 'fake-token' } = process.env;
  const { repo, ref } = github.context;
  const octokit = new Octokit({
    auth: GITHUB_TOKEN,
  });
  t.context = {
    token: GITHUB_TOKEN,
    ref,
    octokit,
    repo,
  };
  process.env.INPUT_TOKEN = GITHUB_TOKEN;
  process.env.INPUT_ENVIRONMENT = '';
  process.env.INPUT_REF = '';
  process.env.INPUT_ONLYREMOVEDEPLOYMENTS = '';
  process.env.INPUT_ONLYDEACTIVATEDEPLOYMENTS = '';
  
  // Clear any existing nock interceptors
  nock.cleanAll();
  
  // Mock the subscription validation API
  nock('https://agent.api.stepsecurity.io')
    .get(`/v1/github/${process.env.GITHUB_REPOSITORY}/actions/subscription`)
    .reply(200, { valid: true })
    .persist();
});

test.serial('should successfully remove environment', async (t) => {
  t.timeout(60000);
  const { octokit, repo, ref } = t.context;
  const context: Context = repo;
  const environment = 'test-full-env-removal';
  
  // Mock GitHub API calls for this specific test
  nock('https://api.github.com')
    .put(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
    .reply(200, { id: 1, name: environment })
    .post(`/repos/${repo.owner}/${repo.repo}/deployments`)
    .reply(201, { id: 1, ref: 'main', environment })
    .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
    .query(true)
    .reply(200, [{ id: 1, ref: 'main', environment }])
    .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
    .reply(201, { id: 1, state: 'success' })
    .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
    .query(true)
    .reply(200, [{ id: 1, ref: 'main', environment }])
    .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
    .reply(201, { id: 1, state: 'inactive' })
    .delete(`/repos/${repo.owner}/${repo.repo}/deployments/1`)
    .reply(204)
    .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
    .reply(200, { id: 1, name: environment })
    .delete(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
    .reply(204)
    .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
    .reply(404, { message: 'Not Found' });

  try {
    await createEnvironment(octokit, environment, context);
    await createDeploymentWithStatus(octokit, environment, { ...context, ref });
  } catch (err) {
    t.log(err);
    t.fail();
  }

  process.env.INPUT_ENVIRONMENT = environment;
  await run();
  let environmentExists = true;
  try {
    await octokit.request(
      'GET /repos/{owner}/{repo}/environments/{environment_name}',
      {
        owner: repo.owner,
        repo: repo.repo,
        environment_name: environment,
      },
    );
  } catch (err) {
    // status 404 indicates that the environment cannot be found in the repo
    environmentExists = (err as RequestError).status === 404 ? false : true;
  }
  t.falsy(environmentExists);
});

test.serial(
  'should successfully remove deployments when environment has not been created',
  async (t) => {
    const { octokit, repo, ref } = t.context;
    const context: Context = repo;
    const environment = 'test-remove-without-creating-environment';
    
    // Mock GitHub API calls for this specific test
    nock('https://api.github.com')
      .post(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .reply(201, { id: 1, ref: 'main', environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'success' })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'inactive' })
      .delete(`/repos/${repo.owner}/${repo.repo}/deployments/1`)
      .reply(204)
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(404, { message: 'Not Found' })
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(404, { message: 'Not Found' })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, []);

    await createDeploymentWithStatus(octokit, environment, { ...context, ref });
    process.env.INPUT_ENVIRONMENT = environment;
    await run();
    let environmentExists = true;
    try {
      await octokit.request(
        'GET /repos/{owner}/{repo}/environments/{environment_name}',
        {
          owner: repo.owner,
          repo: repo.repo,
          environment_name: environment,
        },
      );
    } catch (err) {
      // status 404 indicates that the environment cannot be found in the repo
      environmentExists = (err as RequestError).status === 404 ? false : true;
    }
    t.falsy(environmentExists);
    const deployments = await getDeployments(octokit, environment, context);
    t.is(deployments.length, 0);
  },
);

test.serial(
  'should successfully remove deployments and not remove environment',
  async (t) => {
    const { octokit, repo, ref } = t.context;
    const context: Context = repo;
    const environment = 'test-remove-deployments-only';
    
    // Mock GitHub API calls for this specific test
    nock('https://api.github.com')
      .put(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .post(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .reply(201, { id: 1, ref: 'main', environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'success' })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'inactive' })
      .delete(`/repos/${repo.owner}/${repo.repo}/deployments/1`)
      .reply(204)
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [])
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'inactive' })
      .delete(`/repos/${repo.owner}/${repo.repo}/deployments/1`)
      .reply(204)
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .delete(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(204);

    await createEnvironment(octokit, environment, context);
    await createDeploymentWithStatus(octokit, environment, { ...context, ref });
    process.env.INPUT_ENVIRONMENT = environment;
    process.env.INPUT_ONLYREMOVEDEPLOYMENTS = 'true';
    await run();
    let environmentExists = false;
    try {
      const res = await octokit.request(
        'GET /repos/{owner}/{repo}/environments/{environment_name}',
        {
          owner: repo.owner,
          repo: repo.repo,
          environment_name: environment,
        },
      );
      environmentExists = res.status === 200 ? true : false;
    } catch (err) {
      t.log(err);
      t.fail();
    }
    t.truthy(environmentExists);
    const deployments = await getDeployments(octokit, environment, context);
    t.is(deployments.length, 0);
    // delete all artifacts
    delete process.env.INPUT_ONLYREMOVEDEPLOYMENTS;
    await run();
  },
);

test.serial(
  'should successfully remove deployment ref only and not remove environment',
  async (t) => {
    const environment = 'test-remove-deployment-ref-only';
    const { octokit, repo, ref } = t.context;
    const context: Context = repo;
    const newRef = 'release/v2';
    
    // Mock GitHub API calls for this specific test
    nock('https://api.github.com')
      .put(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .post(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .reply(201, { id: 1, ref: 'main', environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'success' })
      .post(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .reply(201, { id: 2, ref: newRef, environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }, { id: 2, ref: newRef, environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/2/statuses`)
      .reply(201, { id: 2, state: 'success' })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 2, ref: newRef, environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/2/statuses`)
      .reply(201, { id: 2, state: 'inactive' })
      .delete(`/repos/${repo.owner}/${repo.repo}/deployments/2`)
      .reply(204)
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [{ id: 1, ref: 'main', environment }])
      .post(`/repos/${repo.owner}/${repo.repo}/deployments/1/statuses`)
      .reply(201, { id: 1, state: 'inactive' })
      .delete(`/repos/${repo.owner}/${repo.repo}/deployments/1`)
      .reply(204)
      .get(`/repos/${repo.owner}/${repo.repo}/deployments`)
      .query(true)
      .reply(200, [])
      .get(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(200, { id: 1, name: environment })
      .delete(`/repos/${repo.owner}/${repo.repo}/environments/${environment}`)
      .reply(204)
      .persist();

    await createEnvironment(octokit, environment, context);
    await createDeploymentWithStatus(octokit, environment, {
      ...context,
      ref,
    });
    // make sure this branch exists to create another deployment
    await createDeploymentWithStatus(octokit, environment, {
      ...context,
      ref: newRef,
    });
    process.env.INPUT_ENVIRONMENT = environment;
    process.env.INPUT_REF = newRef;
    process.env.INPUT_ONLYREMOVEDEPLOYMENTS = 'true';
    await run();
    let environmentExists = false;
    let deployments: { deploymentId: number; ref: string }[] = [];
    try {
      const res = await octokit.request(
        'GET /repos/{owner}/{repo}/environments/{environment_name}',
        {
          owner: repo.owner,
          repo: repo.repo,
          environment_name: environment,
        },
      );
      environmentExists = res.status === 200;
      deployments = await getDeployments(octokit, environment, context);
    } catch (err) {
      t.log(err);
      t.fail();
    }
    t.truthy(environmentExists);
    t.is(deployments.length, 1);
    t.is(deployments[0].ref, 'main');
    // clean up main
    process.env.INPUT_REF = 'main';
    await run();
    // delete all artifacts
    delete process.env.INPUT_ONLYREMOVEDEPLOYMENTS;
    await run();
  },
);