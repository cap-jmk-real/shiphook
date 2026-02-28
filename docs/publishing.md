# Publishing Shiphook to npm (first-time guide)

This guide walks you through publishing the **shiphook** package to npm using GitHub Actions. You do not run `npm publish` locally — **merging (or pushing) to the `main` branch** triggers the publish workflow and publishes the version in `package.json` to npm.

---

## Prerequisites

- A GitHub repo with the Shiphook code (e.g. `cap-jmk-real/shiphook`).
- The **dev** (or main) branch pushed to GitHub.
- About 10 minutes.

---

## Step 1: Create an npm account

1. Go to [https://www.npmjs.com/signup](https://www.npmjs.com/signup).
2. Sign up with email (or GitHub). Complete verification if asked.
3. Log in at [https://www.npmjs.com](https://www.npmjs.com).

You do **not** need to run `npm login` on your computer for the CI flow — the token is used only in GitHub Secrets.

---

## Step 2: Create an npm Granular Access Token

npm **Classic** tokens are deprecated. Use a **Granular Access Token** so only this package can be published (and only from CI).

1. On npm, click your profile picture (top right) → **Access Tokens**, or go to [https://www.npmjs.com/access/tokens](https://www.npmjs.com/access/tokens).
2. Click **Generate New Token** → **Granular Access Token** (not Classic).
3. **Token name:** e.g. `shiphook-github-publish`.
4. **Expiration:** choose a duration (e.g. 90 days). Write-enabled tokens have a max lifetime; you’ll need to create a new token before it expires.
5. **Packages and scopes:** choose **Read and write** and select:
   - **Only select packages** → add **shiphook** (if the package already exists), or  
   - **All packages** (if you haven’t published shiphook yet).
6. **Bypass 2FA for publish:** enable this so GitHub Actions can publish without interactive 2FA. (Only use for CI.)
7. Click **Generate token**.
8. **Copy the token** and store it somewhere safe (e.g. password manager). You will not see it again.

This token is the **NPM_TOKEN** you will add to GitHub.

**Note:** Granular tokens with write access have a maximum lifetime (e.g. 90 days). When the token expires, create a new one and update the `NPM_TOKEN` secret in GitHub.

---

## Step 3: Add NPM_TOKEN to GitHub repo Secrets

1. Open your repo on GitHub: `https://github.com/cap-jmk-real/shiphook`.
2. Click **Settings** (repo tabs).
3. In the left sidebar, under **Security**, click **Secrets and variables** → **Actions**.
4. Click **New repository secret**.
5. **Name:** `NPM_TOKEN` (exactly that — the workflow uses this name).
6. **Secret:** paste the npm token you copied in Step 2.
7. Click **Add secret**.

Your publish workflow will use this secret to authenticate with npm. Do not share the token or commit it anywhere.

---

## Step 4: Run build and tests locally (optional but recommended)

Before your first release, check that everything passes on your machine:

```bash
cd /path/to/shiphook
npm ci
npm run lint
npm run test
npm run build
```

If any command fails, fix it before creating the release. The same steps run in CI when you publish.

---

## Step 5: Bump the version (release flow)

The workflow publishes whatever **version** is in `package.json` when you push to `main`. CI (on both **dev** and **main**) fails if that version is **already published** to npm, so you must bump before merging to main.

Use the built-in scripts (they bump, commit, and create a git tag):

```bash
npm run version:patch   # 0.1.0 → 0.1.1
# or
npm run version:minor   # 0.1.0 → 0.2.0
# or
npm run version:major   # 0.1.0 → 1.0.0
```

Then push the commit and the new tag to **dev**, then merge **dev** into **main**:

```bash
git push origin dev
git push origin dev --tags
# Then open a PR dev → main, merge. The push to main triggers the publish workflow.
```

---

## Step 6: Merge to main (this triggers the publish)

1. On **dev**, bump the version (Step 5), push, and push tags.
2. Open a **Pull Request** from **dev** into **main** (or merge **dev** into **main**).
3. **Merge** the PR (or push to main).


As soon as **main** is updated, GitHub Actions runs the **Publish to npm** workflow. It will:

- Check out the code
- Install dependencies
- Run tests
- Build
- Run `npm publish --access public` using `NPM_TOKEN`

**CI** runs on every push and PR to **dev** and **main**. It **fails** if the version in `package.json` is already published to npm, so you must run `npm run version:patch` (or minor/major) before merging to main.

---

## Step 7: Check that it worked

1. **Actions tab:** In your repo, open **Actions**. You should see **Publish to npm** running (or completed) after the merge to main. Click it to see logs; if something failed, the logs will show the error.
2. **npm:** Open [https://www.npmjs.com/package/shiphook](https://www.npmjs.com/package/shiphook). After a minute or two, the new version should appear.

If the name **shiphook** is already taken on npm, the publish will fail with a “package name already exists” error. In that case you can use a scoped name (e.g. `@cap-jmk-real/shiphook`) by changing the `name` in `package.json` and publishing again; the first publish for a scoped package also needs `--access public`.

---

## Quick checklist

- [ ] npm account created and logged in
- [ ] npm **Granular Access Token** (read+write, 2FA bypass) generated and copied
- [ ] **NPM_TOKEN** added in GitHub → Settings → Secrets and variables → Actions
- [ ] `npm run build` and `npm run test` pass locally (optional)
- [ ] Version in `package.json` is what you want (e.g. `0.1.0` for first release)
- [ ] On **dev**: bumped version if needed (`npm run version:patch`), pushed and pushed tags
- [ ] Merged **dev** into **main** (or pushed to main)
- [ ] Check **Actions** and **npm** to confirm publish succeeded

---

## Troubleshooting

- **401 / Unauthorized:** NPM_TOKEN is wrong, expired, or missing **Bypass 2FA for publish**. Create a new **Granular Access Token** with read+write for the package and 2FA bypass enabled, then update the GitHub secret.
- **403 / Forbidden:** Ensure the Granular Access Token has **Read and write** for the package (or “All packages”). If the package is scoped (e.g. `@cap-jmk-real/shiphook`), the first publish must use `--access public` (the workflow already does this for the current `shiphook` name).
- **Package name already taken:** Use a scoped name in `package.json`, e.g. `"name": "@cap-jmk-real/shiphook"`, then create a new release and publish again.
- **Workflow not running:** The publish workflow runs on **push to `main`**. Merge (or push) to the `main` branch to trigger it.
- **CI fails with "version already released":** The version in `package.json` is already on npm. Run `npm run version:patch` (or minor/major) on **dev**, commit, push, then merge to main.

For the workflow file, see [.github/workflows/publish.yml](https://github.com/cap-jmk-real/shiphook/blob/dev/.github/workflows/publish.yml) in the repo.
