import {Stage} from '@ovacanvas/core';
import {JSX} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {useApplication} from '../../contexts';
import {
  usePreviewSettings,
  useSharedSettings,
  useSubscribable,
} from '../../hooks';
import {StageView} from './StageView';

export function PreviewStage(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [stage] = useState(() => new Stage());
  const {player} = useApplication();
  const {size, background} = useSharedSettings();
  const {resolutionScale} = usePreviewSettings();

  useSubscribable(
    player.onRender,
    async () => {
      await stage.render(
        player.playback.currentScene,
        player.playback.previousScene,
      );
    },
    [],
  );

  useEffect(() => {
    stage.configure({resolutionScale, size, background});
    player.requestRender();
  }, [resolutionScale, size, background, player]);

  // Unmounting the viewport definitively retires this Stage: a remount calls
  // useState again and builds a new one, so the old canvases would otherwise
  // be retained with nothing able to release them.
  useEffect(() => () => stage.dispose(), [stage]);

  return <StageView stage={stage} {...props} />;
}
