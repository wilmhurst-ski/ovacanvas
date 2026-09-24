import {getCatalogue} from '../catalogue/index.js';
import {prepareDocument} from '../kits/expand.js';
import type {Issue} from './issues.js';
import type {ValidateOptions} from './validate.js';

export {
  KITS,
  prepareDocument,
  usesKits,
  type PreparedDocument,
} from '../kits/expand.js';

/**
 * Check a document - plain nodes, or kits and beats - against the catalogue
 * and the engine's beat rules. Every issue is located on what the author
 * wrote: a node or kit id, a prop or kit field, a timeline step or a beat.
 */
export function validateDocument(
  input: unknown,
  options: ValidateOptions = {},
): Issue[] {
  return [
    ...prepareDocument(input, options.catalogue ?? getCatalogue()).issues,
  ];
}
