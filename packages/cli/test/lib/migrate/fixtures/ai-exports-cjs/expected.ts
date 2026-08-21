// TODO(sentry-javascript-v11): instrumentOpenAiClient moved to `@sentry/server-utils`. Require them from there instead
const { instrumentOpenAiClient, captureException } = require("@sentry/core");

module.exports = { instrumentOpenAiClient, captureException };
