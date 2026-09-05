const buildFrontendEslintCommand = (filenames) =>
  // ESLint 9 flat config takes files as positional args; yarn runs the
  // script inside packages/nextjs, so strip that prefix from staged paths.
  `yarn workspace @tradelayer/frontend lint --fix ${filenames
    .map((f) => f.replace(/^packages\/nextjs\//, ""))
    .join(" ")}`;

const checkTypesFrontendCommand = () =>
  "yarn workspace @tradelayer/frontend check-types";

const buildHardhatEslintCommand = (filenames) =>
  `yarn foundry:lint --fix ${filenames
    .map((f) => f.replace(/^packages\/foundry\//, ""))
    .join(" ")}`;

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [
    buildFrontendEslintCommand,
    checkTypesFrontendCommand,
  ],
  "packages/foundry/**/*.{ts,tsx}": [buildHardhatEslintCommand],
};
