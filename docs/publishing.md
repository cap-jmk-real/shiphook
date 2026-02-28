# Publishing Shiphook to npm (first-time guide)

This guide walks you through publishing the **shiphook** package to npm using GitHub Actions. You do not need to run `npm publish` on your machine — the workflow runs when you create a **Release** on GitHub.

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

## Step 5: Bump the version (if you want a specific version)

The workflow publishes whatever **version** is in `package.json` at the time of the release.

- For the **first** publish, `0.1.0` is fine — no change needed.
- For **later** releases, bump the version before (or when) you create the release:

```bash
npm version patch   # 0.1.0 → 0.1.1
# or
npm version minor   # 0.1.0 → 0.2.0
# or
npm version major   # 0.1.0 → 1.0.0
```

Then push the updated `package.json` (and `package-lock.json` if it changed):

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 0.1.1"
git push origin dev
```

---

## Step 6: Create a GitHub Release (this triggers the publish)

1. On GitHub, open your repo → **Releases** (right-hand side, or **Code** tab → link under “Releases”).
2. Click **Create a new release** (or **Draft a new release**).
3. **Choose a tag:**
   - Click **Choose a tag**.
   - Type a new tag, e.g. `v0.1.0`, and click **Create new tag: v0.1.0**.
   - Select the tag to base it on: usually the branch you just pushed (e.g. `dev` or `main`).
4. **Release title:** e.g. `v0.1.0` or `Shiphook 0.1.0`.
5. **Description:** optional; you can add short release notes.
6. Leave **Set as the latest release** checked.
7. Click **Publish release**.

As soon as the release is published, GitHub Actions runs the **Publish to npm** workflow. It will:

- Check out the code
- Install dependencies
- Run tests
- Build
- Run `npm publish --access public` using `NPM_TOKEN`

---

## Step 7: Check that it worked

1. **Actions tab:** In your repo, open **Actions**. You should see the workflow **Publish to npm** running (or completed). Click it to see logs; if something failed, the logs will show the error.
2. **npm:** Open [https://www.npmjs.com/package/shiphook](https://www.npmjs.com/package/shiphook). After a minute or two, the new version should appear.

If the name **shiphook** is already taken on npm, the publish will fail with a “package name already exists” error. In that case you can use a scoped name (e.g. `@cap-jmk-real/shiphook`) by changing the `name` in `package.json` and publishing again; the first publish for a scoped package also needs `--access public`.

---

## Quick checklist

- [ ] npm account created and logged in
- [ ] npm **Granular Access Token** (read+write, 2FA bypass) generated and copied
- [ ] **NPM_TOKEN** added in GitHub → Settings → Secrets and variables → Actions
- [ ] `npm run build` and `npm run test` pass locally (optional)
- [ ] Version in `package.json` is what you want (e.g. `0.1.0` for first release)
- [ ] Code pushed to the branch you will tag (e.g. `dev`)
- [ ] New release created with a tag (e.g. `v0.1.0`) and **Publish release** clicked
- [ ] Check **Actions** and **npm** to confirm publish succeeded

---

## Troubleshooting

- **401 / Unauthorized:** NPM_TOKEN is wrong, expired, or missing **Bypass 2FA for publish**. Create a new **Granular Access Token** with read+write for the package and 2FA bypass enabled, then update the GitHub secret.
- **403 / Forbidden:** Ensure the Granular Access Token has **Read and write** for the package (or “All packages”). If the package is scoped (e.g. `@cap-jmk-real/shiphook`), the first publish must use `--access public` (the workflow already does this for the current `shiphook` name).
- **Package name already taken:** Use a scoped name in `package.json`, e.g. `"name": "@cap-jmk-real/shiphook"`, then create a new release and publish again.
- **Workflow not running:** Ensure the trigger is **Release: published**. Draft releases do not trigger it; you must click **Publish release**.

For more on the workflow file, see [.github/workflows/publish.yml](https://github.com/cap-jmk-real/shiphook/blob/dev/.github/workflows/publish.yml) in the repo.
