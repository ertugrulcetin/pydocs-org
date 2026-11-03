// Refuses to continue on a case-insensitive disk: there, pages such as
// /logging/DEBUG and /logging/debug overwrite each other, so the build must
// not be deployed. Production deploys run in CI on Linux.
import { isCaseInsensitive } from './case-sensitivity.mjs';

if (await isCaseInsensitive(process.cwd())) {
  console.error(
    'Refusing to deploy: this disk is case-insensitive, so pages that differ only in case ' +
      '(e.g. /logging/DEBUG and /logging/debug) overwrite each other. Deploy from CI (Linux).',
  );
  process.exit(1);
}
