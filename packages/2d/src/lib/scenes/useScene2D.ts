import {useScene} from '@ovacanvas/core';
import type {Scene2D} from './Scene2D';

export function useScene2D(): Scene2D {
  return <Scene2D>useScene();
}
