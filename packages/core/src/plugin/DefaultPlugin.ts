import {ImageExporter} from '../app';
import {makePlugin} from './makePlugin';

/**
 * The default plugin included in every Motion Canvas project.
 *
 * @internal
 */
export default makePlugin({
  name: '@ovacanvas/core/default',
  exporters() {
    return [ImageExporter];
  },
});
