import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {LessonOutcome, PreviewOutcome} from '../node/preview.js';
import {createWireServer} from './server.js';

type ToolResult = {
  content: {type: string; text?: string; data?: string}[];
  isError?: boolean;
};

let Workspace: string;
let TestClient: Client;
let CloseServer: () => Promise<void>;
const RENDERS: unknown[] = [];

beforeEach(async () => {
  Workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-mcp-'));
  RENDERS.length = 0;
  // A fake renderer: these tests are about the tools, not the browser (the
  // real render path has its own test in node/preview.test.ts).
  const renderer = {
    async render(document: unknown): Promise<PreviewOutcome> {
      RENDERS.push(document);
      return {
        ok: true,
        issues: [],
        findings: [],
        initialFindings: [],
        frames: [{at: 0, png: 'iVBORw0KGgo='}],
        durationSeconds: 1,
        layout: {title: {position: [5, -380], box: [0, 0, 10, 10]}},
        adjustments: [{node: 'title', from: [0, -380], to: [5, -380]}],
      };
    },
    async renderLesson(document: unknown): Promise<LessonOutcome> {
      RENDERS.push(document);
      const part = {
        ok: true,
        issues: [],
        findings: [],
        initialFindings: [],
        frames: [{at: 1, png: 'iVBORw0KGgo='}],
        durationSeconds: 5,
        scene: 0,
        beats: [0],
      };
      return {
        ok: true,
        issues: [],
        parts: [
          {...part, id: 'lesson-1'},
          {...part, id: 'lesson-2', beats: [1]},
        ],
        continuity: [{after: 'lesson-1', difference: 0, sceneChange: false}],
        durationSeconds: 10,
      };
    },
    async close() {},
  };
  const created = createWireServer({workspace: Workspace, renderer});
  CloseServer = created.close;
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await created.server.connect(serverTransport);
  TestClient = new Client({name: 'test', version: '0'});
  await TestClient.connect(clientTransport);
});

afterEach(async () => {
  await TestClient.close();
  await CloseServer();
  fs.rmSync(Workspace, {recursive: true, force: true});
});

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  return (await TestClient.callTool({name, arguments: args})) as ToolResult;
}

function textOf(result: ToolResult): string {
  return result.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n');
}

const TITLE = {
  id: 'title',
  component: 'Txt',
  props: {text: 'Heading', position: [0, -380]},
};

describe('the wire MCP server', () => {
  it('lists its tools', async () => {
    const {tools} = await TestClient.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(
      [
        'apply_adjustments',
        'create_scene',
        'describe_component',
        'edit_scene',
        'generate_code',
        'get_scene',
        'list_components',
        'open_scene',
        'reference',
        'render_scene',
        'save_scene',
        'validate',
      ].sort(),
    );
  });

  it('serves the reference and the catalogue', async () => {
    expect(textOf(await call('reference'))).toContain(
      '# OvaCanvas scene documents',
    );
    expect(textOf(await call('list_components', {query: 'label'}))).toContain(
      'AnchoredLabel',
    );
    expect(
      JSON.parse(textOf(await call('describe_component', {name: 'Latex'})))
        .props.tex,
    ).toBeDefined();
    const missing = await call('describe_component', {name: 'Latx'});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('Latex');
  });

  it('builds a scene with atomic edit batches and saves it after each change', async () => {
    await call('create_scene', {title: 'Demo', file: 'demo'});
    const refused = await call('edit_scene', {
      scene: 'scene1',
      ops: [
        {op: 'add_node', node: TITLE},
        {
          op: 'add_node',
          node: {
            id: 'box',
            component: 'Rect',
            props: {size: 100, colour: 'red'},
          },
        },
      ],
    });
    expect(refused.isError).toBe(true);
    const report = JSON.parse(textOf(refused));
    expect(report.changed).toBe(false);
    expect(report.wouldIntroduce).toContain('did you mean "fill"');
    expect(
      JSON.parse(textOf(await call('get_scene', {scene: 'scene1'}))).nodes,
    ).toEqual([]);

    const accepted = await call('edit_scene', {
      scene: 'scene1',
      ops: [
        {op: 'add_node', node: TITLE},
        {
          op: 'add_node',
          node: {id: 'box', component: 'Rect', props: {size: 100, fill: 'red'}},
        },
        {op: 'add_step', step: {kind: 'wait', seconds: 1}},
      ],
    });
    expect(accepted.isError).toBeFalsy();
    const saved = JSON.parse(
      fs.readFileSync(path.join(Workspace, 'demo.ovw.json'), 'utf8'),
    );
    expect(saved.nodes.map((n: {id: string}) => n.id)).toEqual([
      'title',
      'box',
    ]);
  });

  it('opens a saved scene', async () => {
    fs.writeFileSync(
      path.join(Workspace, 'saved.ovw.json'),
      JSON.stringify({version: 1, nodes: [TITLE], timeline: []}),
    );
    const opened = JSON.parse(
      textOf(await call('open_scene', {file: 'saved.ovw.json'})),
    );
    expect(opened.nodes).toEqual(['title: Txt']);
  });

  it('validates and generates from an inline document', async () => {
    const bad = JSON.parse(
      textOf(
        await call('validate', {
          document: {
            version: 1,
            nodes: [{id: 'x', component: 'Txt', props: {text: 'x^2'}}],
            timeline: [],
          },
        }),
      ),
    );
    expect(bad.issues[0].code).toBe('plain_text_math');
    const generated = await call('generate_code', {
      document: {version: 1, nodes: [TITLE], timeline: []},
      file: 'out/beat',
    });
    expect(textOf(generated)).toContain('export function buildAuditSpec()');
    expect(
      fs.readFileSync(path.join(Workspace, 'out/beat.ts'), 'utf8'),
    ).toContain("from '@ovacanvas/2d'");
  });

  it('renders, returns images, and applies the host adjustments back into the scene', async () => {
    await call('create_scene', {});
    await call('edit_scene', {
      scene: 'scene1',
      ops: [{op: 'add_node', node: TITLE}],
    });
    const rendered = await call('render_scene', {scene: 'scene1'});
    expect(rendered.content.some(c => c.type === 'image')).toBe(true);
    expect(JSON.parse(textOf(rendered)).adjustments[0].node).toBe('title');
    await call('apply_adjustments', {scene: 'scene1'});
    const scene = JSON.parse(
      textOf(await call('get_scene', {scene: 'scene1'})),
    );
    expect(scene.nodes[0].props.position).toEqual([5, -380]);
  });

  /* eslint-disable @typescript-eslint/naming-convention -- geometry point names are capital letters */
  it('lists and describes kits, and builds a scene from them', async () => {
    const listing = textOf(await call('list_components'));
    expect(listing).toContain('KITS');
    expect(listing).toContain('geometry.figure');
    const kit = JSON.parse(
      textOf(await call('describe_component', {name: 'derivation'})),
    );
    expect(kit.fields.steps.required).toBe(true);
    expect(textOf(await call('reference'))).toContain('## Kits - prefer these');

    await call('create_scene', {});
    const refused = await call('edit_scene', {
      scene: 'scene1',
      ops: [
        {
          op: 'add_node',
          node: {
            id: 'fig',
            kit: 'geometry.figure',
            points: {A: [0, 0], B: [4, 0]},
            segments: 'AC',
          },
        },
      ],
    });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(textOf(refused)).wouldIntroduce).toContain(
      'unknown point "C"',
    );

    const built = await call('edit_scene', {
      scene: 'scene1',
      ops: [
        {
          op: 'add_node',
          node: {
            id: 'fig',
            kit: 'geometry.figure',
            region: 'left',
            points: {A: [0, 3], B: [4, 3], C: [0, 0]},
            segments: 'AB BC CA',
          },
        },
        {op: 'update_node', id: 'fig', fields: {rightAngles: ['BAC']}},
        {op: 'set_beats', beats: [{highlight: 'fig.ABC'}, {hold: 0.5}]},
      ],
    });
    expect(built.isError).toBeFalsy();
    const state = JSON.parse(textOf(built)).state;
    expect(state.nodes).toEqual(['fig: kit geometry.figure']);
    expect(state.beats).toBe(2);
    expect(state.errors).toBe(0);
    const generated = await call('generate_code', {scene: 'scene1'});
    expect(textOf(generated)).toContain('fig_hlABC');
  });

  it('does not render a document that fails validation', async () => {
    const result = await call('render_scene', {
      document: {
        version: 1,
        nodes: [{id: 'x', component: 'Nope'}],
        timeline: [],
      },
    });
    expect(result.isError).toBe(true);
    expect(RENDERS).toEqual([]);
  });

  it('renders a lesson part by part', async () => {
    const result = await call('render_scene', {
      document: {
        version: 1,
        scenes: [
          {
            nodes: [{id: 'heading', kit: 'title', text: 'Part one'}],
            beats: [{hold: 1}],
          },
          {
            keep: ['heading'],
            nodes: [{id: 'why', kit: 'list', items: [{text: 'Because'}]}],
            beats: [{show: 'why.0'}],
          },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const report = JSON.parse(textOf(result)) as {
      lesson: boolean;
      parts: unknown[];
    };
    expect(report.lesson).toBe(true);
    expect(report.parts).toHaveLength(2);
    expect(result.content.filter(c => c.type === 'image')).toHaveLength(2);
    expect(RENDERS).toHaveLength(1);
  });
});
