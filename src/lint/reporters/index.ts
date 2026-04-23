import { textReporter } from './text.js';
import { jsonReporter } from './json.js';
import { sarifReporter } from './sarif.js';
import type { Reporter, ReporterName } from './types.js';

export type { Reporter, ReporterName } from './types.js';

export function pickReporter(name: ReporterName | string | undefined): Reporter {
  switch (name) {
    case 'json':
      return jsonReporter;
    case 'sarif':
      return sarifReporter;
    case 'text':
    case undefined:
    case '':
      return textReporter;
    default:
      console.warn(`Unknown --format value '${name}', defaulting to text.`);
      return textReporter;
  }
}
