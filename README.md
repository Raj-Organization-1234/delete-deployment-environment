# delete-deployment-environment

GitHub Action to deactivate and optionally delete deployments and GitHub environments.

This action:
- Marks all matching deployments as `inactive`
- Optionally deletes those deployments
- Optionally deletes the entire GitHub environment

### 🧩 Behavior Options

- Set `onlyRemoveDeployments: true` to delete deployments but keep the environment.
- Set `onlyDeactivateDeployments: true` to deactivate deployments without deleting them or the environment.
- Set `ref: my-branch` to limit actions to a specific deployment ref.

**Note:** if you set `onlyDeactivateDeployments: true` and `onlyRemoveDeployments: true`, `onlyRemoveDeployments` will override
`onlyDeactivateDeployments` and deployments will be removed.

⚠️ **Note:** To delete an environment, you must use a token with `repo` scope. The default `${{ github.token }}` does not have this permission. See [Delete an environment REST API docs](https://docs.github.com/en/rest/reference/repos#delete-an-environment).

---

## 🔑 How to Use a Proper Token

If you need to delete environments, you'll need a GitHub App with admin permissions:

1. [Create a GitHub App](https://docs.github.com/en/developers/apps/building-github-apps/creating-a-github-app)
2. [Generate a Private Key](https://docs.github.com/en/developers/apps/building-github-apps/authenticating-with-github-apps#generating-a-private-key)
3. Add your App ID and Private Key as [repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
4. Use [navikt/github-app-token-generator](https://github.com/navikt/github-app-token-generator) to generate the token

### 🧪 Example: Use With GitHub App Token

```yaml
name: 🧼 Clean up environment
on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - uses: actions/checkout@v4

      - name: 🎟 Get GitHub App token
        uses: navikt/github-app-token-generator@v1
        id: get-token
        with:
          app-id: ${{ secrets.GH_APP_ID }}
          private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}

      - name: Delete deployment env
        uses: step-security/delete-deployment-environment@v1
        with:
          token: ${{ steps.get-token.outputs.token }}
          environment: pr-${{ github.event.number }}
          ref: ${{ github.ref_name }}
```

---

## 🔧 Inputs

| Name                      | Description                                                                 |
|---------------------------|-----------------------------------------------------------------------------|
| `token`                   | GitHub token with permissions (not `${{ github.token }}` for env deletion) |
| `environment`             | Name of the environment to manage                                           |
| `onlyRemoveDeployments`   | If `true`, deletes deployments only                                         |
| `onlyDeactivateDeployments` | If `true`, deactivates deployments but does not delete                    |
| `ref`                     | Optional branch ref to target specific deployments                         |

---

## 🚀 Usage Examples

### 🧨 Delete everything (default)
```yaml
- uses: step-security/delete-deployment-environment@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    environment: my-environment-name
```

### 🗑 Delete deployments but keep environment
```yaml
- uses: step-security/delete-deployment-environment@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    environment: my-environment-name
    onlyRemoveDeployments: true
```

### 🎯 Remove a specific deployment ref
```yaml
- uses: step-security/delete-deployment-environment@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    environment: my-environment-name
    ref: my-branch
    onlyRemoveDeployments: true
```

### 🚫 Just deactivate deployments
```yaml
- uses: step-security/delete-deployment-environment@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    environment: my-environment-name
    onlyDeactivateDeployments: true
```
