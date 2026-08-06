# PrivacyScreen

Fills your GitHub contribution graph with **natural-looking random activity** over the last three years — varied shading, quieter weekends, no obvious patterns.

## How it works

`generate.js` walks each day for the past 3 years and, with weighted randomness, creates backdated commits. Intensity is skewed toward light/medium days so the graph reads as organic rather than painted solid green.

## Usage

```bash
npm run generate
```

Reset and regenerate (new pattern unless you set a seed):

```bash
npm run generate -- --reset
# or keep the same pattern:
PRIVACY_SEED=12345 npm run generate -- --reset
```

Then push:

```bash
git push -u origin main
```

## Notes

- Commits must use an email verified on your GitHub account (this repo uses your local `user.email`).
- Private repos only appear on the graph if **Include private contributions** is enabled in GitHub settings.
- GitHub can take a few minutes to refresh the contribution calendar after a push.
