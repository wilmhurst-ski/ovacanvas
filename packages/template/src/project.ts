import {makeProject} from '@ovacanvas/core';

import example from './scenes/example?scene';

export default makeProject({
  experimentalFeatures: true,
  scenes: [example],
});
