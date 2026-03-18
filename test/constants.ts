/**
 * Shared test constants.
 *
 * This file must have NO imports from src/ so that preload.ts can
 * safely import it before the test environment is fully initialized.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

/** Namespaced subdirectory under the OS temp dir for all test artifacts. */
export const TEST_TMP_DIR = join(tmpdir(), "sentry-cli-test");
