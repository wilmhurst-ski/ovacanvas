import {makeProject} from '@ovacanvas/core';

import derivatives from './scenes/derivatives?scene';

export default makeProject({
  experimentalFeatures: true,
  scenes: [derivatives],
});
