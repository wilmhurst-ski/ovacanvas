/// <reference types="@ovacanvas/core/project" />

// The donor ships a `*?scene` declaration in @ovacanvas/core/project.d.ts
// but no `*?project` one, so the virtual module has to be declared locally.
declare module '*?project' {
  const value: import('@ovacanvas/core').Project;
  export default value;
}

declare module '*.mp4' {
  const value: string;
  export default value;
}

declare module '*.wav' {
  const value: string;
  export default value;
}
