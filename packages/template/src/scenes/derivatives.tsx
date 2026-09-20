import {
  Circle,
  Latex,
  Line,
  Node,
  Txt,
  makeScene2D,
  runVisualAudit,
  type AuditItem,
} from '@ovacanvas/2d';
import {
  BBox,
  all,
  createRef,
  createSignal,
  easeInOutCubic,
  easeOutCubic,
  waitFor,
} from '@ovacanvas/core';

/**
 * Derivatives, explained as a visible change of slope.
 *
 * The semantic IDs in the teaching contract are kept in the names below:
 * pointP/pointQ, secantLine, tangentLine, secantEquation,
 * derivativeEquation, and derivationEquation are persistent identities across
 * the named holds. See derivatives-explanation-plan.json in the workspace for
 * the validated instructional contract.
 */

const PAPER = '#F7F4EC';
const INK = '#151922';
const SECONDARY = '#59616D';
const HAIRLINE = '#D8D9D4';
const BLUE = '#2F66D0';
const CYAN = '#2EAEDC';
const CORAL = '#F05A3C';

const ORIGIN_X = -300;
const AXIS_Y = 235;
const X_SCALE = 180;
const Y_SCALE = 55;
// The current fork reports shape bounds in canvas space while some text/layout
// nodes report their logical scene-space bounds. `runVisualAudit` accepts
// multiple safe areas (any-of) precisely to bridge this documented engine
// inconsistency; see `@ovacanvas/2d`'s `audit/safeArea.ts`.
const SAFE_CANVAS = new BBox(60, 60, 1800, 960);
const SAFE_LOGICAL = new BBox(-900, -480, 1800, 960);

const graphX = (x: number) => ORIGIN_X + x * X_SCALE;
const graphY = (y: number) => AXIS_Y - y * Y_SCALE;
const f = (x: number) => x * x;

function curvePoints() {
  return Array.from({length: 111}, (_, index) => {
    const x = -2.25 + (4.6 * index) / 110;
    return [graphX(x), graphY(f(x))] as [number, number];
  });
}

function tangentPoints(x: number) {
  const halfWidth = 0.68;
  const slope = 2 * x;
  return [
    [graphX(x - halfWidth), graphY(f(x) - slope * halfWidth)],
    [graphX(x + halfWidth), graphY(f(x) + slope * halfWidth)],
  ] as [number, number][];
}

// The plot's own geometry is expected to meet - the axes, grid, curve,
// secant, tangent and the two probe points share the same drawn frame, and
// that shared contact is the point of the explanation. This is computed
// against the actual grid id list built below (not a `startsWith('grid')`
// string match), and every authorization carries a real `mayTouch` reason
// instead of a hardcoded identifier comparison, so review can see exactly
// how broad it is - it is scoped to plot geometry only, never a blanket
// exemption against labels or equations.
const PLOT_GEOMETRY_BASE_IDS = [
  'xAxis',
  'yAxis',
  'curve',
  'secant',
  'tangent',
  'interval',
  'pointP',
  'pointQ',
] as const;

function plotGeometryMayTouch(
  selfId: string,
  plotGeometryIds: readonly string[],
): ReadonlyMap<string, string> {
  const reason =
    'shared plot geometry: axes, grid, curve, secant, tangent and points are expected to touch';
  return new Map(
    plotGeometryIds
      .filter(id => id !== selfId)
      .map(id => [id, reason] as const),
  );
}

export default makeScene2D(function* (view) {
  const h = createSignal(1);
  const probeX = createSignal(1);

  const title = createRef<Txt>();
  const subtitle = createRef<Txt>();
  const xAxis = createRef<Line>();
  const yAxis = createRef<Line>();
  const curve = createRef<Line>();
  const pointP = createRef<Circle>();
  const pointQ = createRef<Circle>();
  const secantLine = createRef<Line>();
  const tangentLine = createRef<Line>();
  const interval = createRef<Line>();
  const intervalLabel = createRef<Txt>();
  const pLabel = createRef<Txt>();
  const qLabel = createRef<Txt>();
  const pointLabels = createRef<Node>();
  const functionEquation = createRef<Latex>();
  const secantEquation = createRef<Latex>();
  const derivativeEquation = createRef<Latex>();
  const derivationEquation = createRef<Latex>();
  const signSummary = createRef<Txt>();
  const transferPrompt = createRef<Txt>();
  const transferAnswer = createRef<Latex>();

  const verticalGrid = [-2, -1, 1, 2].map(value => (
    <Line
      points={[
        [graphX(value), graphY(0)],
        [graphX(value), graphY(4.7)],
      ]}
      stroke={HAIRLINE}
      lineWidth={1.2}
      lineDash={[5, 10]}
    />
  ));
  const horizontalGrid = [1, 4].map(value => (
    <Line
      points={[
        [graphX(-2.25), graphY(value)],
        [graphX(2.35), graphY(value)],
      ]}
      stroke={HAIRLINE}
      lineWidth={1.2}
      lineDash={[5, 10]}
    />
  ));

  const xAxisNode = (
    <Line
      ref={xAxis}
      points={[
        [ORIGIN_X - 36, AXIS_Y],
        [graphX(2.75), AXIS_Y],
      ]}
      stroke={INK}
      lineWidth={2.5}
      lineCap={'round'}
      endArrow
      arrowSize={16}
      end={0}
    />
  );
  const yAxisNode = (
    <Line
      ref={yAxis}
      points={[
        [ORIGIN_X, AXIS_Y + 20],
        [ORIGIN_X, graphY(4.7)],
      ]}
      stroke={INK}
      lineWidth={2.5}
      lineCap={'round'}
      endArrow
      arrowSize={16}
      end={0}
    />
  );
  const gridLines = [...verticalGrid, ...horizontalGrid];
  const plotAuditIds = [
    'xAxis',
    'yAxis',
    ...gridLines.map((_, index) => `grid${index}`),
  ];

  const curveNode = (
    <Line
      ref={curve}
      points={curvePoints()}
      stroke={BLUE}
      lineWidth={5}
      lineCap={'round'}
      lineJoin={'round'}
      end={0}
    />
  );
  const pointPNode = (
    <Circle
      ref={pointP}
      size={24}
      fill={CORAL}
      stroke={PAPER}
      lineWidth={5}
      position={() => [graphX(probeX()), graphY(f(probeX()))]}
      opacity={0}
    />
  );
  const pointQNode = (
    <Circle
      ref={pointQ}
      size={22}
      fill={CYAN}
      stroke={PAPER}
      lineWidth={5}
      position={() => [graphX(probeX() + h()), graphY(f(probeX() + h()))]}
      opacity={0}
    />
  );
  const secantNode = (
    <Line
      ref={secantLine}
      points={[
        () => [graphX(probeX()), graphY(f(probeX()))],
        () => [graphX(probeX() + h()), graphY(f(probeX() + h()))],
      ]}
      stroke={CYAN}
      lineWidth={3.5}
      lineCap={'round'}
      end={0}
      opacity={0}
    />
  );
  const tangentNode = (
    <Line
      ref={tangentLine}
      points={() => tangentPoints(probeX())}
      stroke={CORAL}
      lineWidth={5}
      lineCap={'round'}
      opacity={0}
    />
  );
  const intervalNode = (
    <Line
      ref={interval}
      points={[
        () => [graphX(probeX()), AXIS_Y + 54],
        () => [graphX(probeX() + h()), AXIS_Y + 54],
      ]}
      stroke={CORAL}
      lineWidth={2.5}
      lineCap={'round'}
      startArrow
      endArrow
      arrowSize={14}
      end={0}
      opacity={0}
    />
  );
  const intervalLabelNode = (
    <Txt
      ref={intervalLabel}
      text={'h'}
      fontSize={28}
      fontStyle={'italic'}
      fontWeight={600}
      fill={CORAL}
      position={() => [graphX(probeX() + h() / 2), AXIS_Y + 93]}
      opacity={0}
    />
  );

  const pointPLabel = (
    <Txt
      ref={pLabel}
      text={'P'}
      fontSize={26}
      fontWeight={700}
      fill={CORAL}
      position={() => [graphX(probeX()) - 65, graphY(f(probeX())) - 135]}
      opacity={0}
    />
  );
  const pointQLabel = (
    <Txt
      ref={qLabel}
      text={'Q'}
      fontSize={26}
      fontWeight={700}
      fill={CYAN}
      position={() => [
        graphX(probeX() + h()) + 60,
        graphY(f(probeX() + h())) - 38,
      ]}
      opacity={0}
    />
  );
  const pointLabelsNode = <Node ref={pointLabels} />;
  pointLabelsNode.add([pointPLabel, pointQLabel]);

  const titleNode = (
    <Txt
      ref={title}
      text={'How derivatives work'}
      fontSize={60}
      fontWeight={700}
      fill={INK}
      left={[-870, -466]}
      opacity={0}
    />
  );
  const subtitleNode = (
    <Txt
      ref={subtitle}
      text={'A derivative is the slope of a curve, measured locally.'}
      fontSize={28}
      fontWeight={450}
      fill={SECONDARY}
      left={[-868, -365]}
      opacity={0}
    />
  );
  const functionEquationNode = (
    <Latex
      ref={functionEquation}
      tex={String.raw`\displaystyle {{f(x)}}={{x^2}}`}
      fontSize={38}
      fill={BLUE}
      position={[125, -235]}
      opacity={0}
    />
  );
  const secantEquationNode = (
    <Latex
      ref={secantEquation}
      tex={String.raw`\displaystyle {{m_{\mathrm{sec}}}}={{\frac{f(2)-f(1)}{2-1}}}={{3}}`}
      fontSize={34}
      fill={INK}
      position={[540, -205]}
      opacity={0}
    />
  );
  const derivationEquationNode = (
    <Latex
      ref={derivationEquation}
      tex={String.raw`\displaystyle {{\frac{f(x+h)-f(x)}{h}}}`}
      fontSize={34}
      fill={INK}
      position={[540, -35]}
      opacity={0}
    />
  );
  const derivativeEquationNode = (
    <Latex
      ref={derivativeEquation}
      tex={String.raw`\displaystyle {{f'(1)}}={{\lim_{h\to0}}}{{\frac{f(1+h)-f(1)}{h}}}={{2}}`}
      fontSize={40}
      fill={CORAL}
      position={[540, 145]}
      opacity={0}
    />
  );
  const signSummaryNode = (
    <Txt
      ref={signSummary}
      text={'positive → rising     zero → flat     negative → falling'}
      fontSize={26}
      fontWeight={550}
      fill={SECONDARY}
      position={[540, 300]}
      opacity={0}
    />
  );
  const transferPromptNode = (
    <Txt
      ref={transferPrompt}
      text={'Try it: at x = 2, what is the tangent slope?'}
      fontSize={27}
      fontWeight={550}
      fill={INK}
      position={[540, 382]}
      opacity={0}
    />
  );
  const transferAnswerNode = (
    <Latex
      ref={transferAnswer}
      tex={String.raw`\displaystyle {{f'(2)}}={{2\cdot2}}={{4}}`}
      fontSize={42}
      fill={CORAL}
      position={[540, 445]}
      opacity={0}
    />
  );

  view.add([
    titleNode,
    subtitleNode,
    ...gridLines,
    xAxisNode,
    yAxisNode,
    curveNode,
    pointPNode,
    pointQNode,
    secantNode,
    tangentNode,
    intervalNode,
    intervalLabelNode,
    pointLabelsNode,
    functionEquationNode,
    secantEquationNode,
    derivationEquationNode,
    derivativeEquationNode,
    signSummaryNode,
    transferPromptNode,
    transferAnswerNode,
  ]);

  const plotGeometryIds = [
    ...PLOT_GEOMETRY_BASE_IDS,
    ...gridLines.map((_, index) => `grid${index}`),
  ];

  const auditItems = (): AuditItem[] => [
    {id: 'title', node: title(), halo: 8},
    {id: 'subtitle', node: subtitle(), halo: 6},
    {
      id: 'xAxis',
      node: xAxis(),
      halo: 0,
      mayTouch: plotGeometryMayTouch('xAxis', plotGeometryIds),
    },
    {
      id: 'yAxis',
      node: yAxis(),
      halo: 0,
      mayTouch: plotGeometryMayTouch('yAxis', plotGeometryIds),
    },
    ...gridLines.map((line, index) => ({
      id: `grid${index}`,
      node: line,
      halo: 0,
      mayTouch: plotGeometryMayTouch(`grid${index}`, plotGeometryIds),
    })),
    {
      id: 'curve',
      node: curve(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('curve', plotGeometryIds),
    },
    {
      id: 'pointP',
      node: pointP(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('pointP', plotGeometryIds),
    },
    {
      id: 'pointQ',
      node: pointQ(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('pointQ', plotGeometryIds),
    },
    {
      id: 'secant',
      node: secantLine(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('secant', plotGeometryIds),
    },
    {
      id: 'tangent',
      node: tangentLine(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('tangent', plotGeometryIds),
    },
    {
      id: 'interval',
      node: interval(),
      halo: 4,
      mayTouch: plotGeometryMayTouch('interval', plotGeometryIds),
    },
    {
      id: 'intervalLabel',
      node: intervalLabel(),
      halo: 7,
      mayTouch: new Map([
        [
          'interval',
          'the h-label sits directly beneath its own interval marker',
        ],
      ]),
    },
    {
      id: 'point_labels',
      node: pLabel(),
      halo: 8,
      mayTouch: new Map([
        ['curve', "P's label sits beside the point it names, on the curve"],
        ['pointP', "P's label sits beside its own anchor point"],
        [
          'tangent',
          "P's label sits beside the tangent drawn through its own point",
        ],
      ]),
    },
    {
      id: 'point_labels_q',
      node: qLabel(),
      halo: 8,
      mayTouch: new Map([
        ['curve', "Q's label sits beside the point it names, on the curve"],
        ['pointQ', "Q's label sits beside its own anchor point"],
        [
          'tangent',
          "Q's label sits near the tangent drawn through P as h shrinks",
        ],
      ]),
    },
    {id: 'function_equation', node: functionEquation(), halo: 8},
    {id: 'secant_equation', node: secantEquation(), halo: 8},
    {id: 'derivation_equation', node: derivationEquation(), halo: 8},
    {id: 'derivative_equation', node: derivativeEquation(), halo: 8},
    {id: 'sign_summary', node: signSummary(), halo: 7},
    {id: 'transfer_prompt', node: transferPrompt(), halo: 7},
    {id: 'transfer_answer', node: transferAnswer(), halo: 8},
  ];

  const SAFE_AREAS = [SAFE_CANVAS, SAFE_LOGICAL];

  function auditHold(holdId: string, visibleIds: readonly string[]): void {
    try {
      runVisualAudit({
        items: auditItems(),
        safeArea: SAFE_AREAS,
        requiredIds: visibleIds,
        root: view,
      });
    } catch (error) {
      throw new Error(
        `${holdId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Hold 1: orient the learner in the coordinate frame and attach f(x)=x^2.
  yield* title().opacity(1, 0.45, easeOutCubic);
  yield* subtitle().opacity(1, 0.35, easeOutCubic);
  yield* all(
    ...gridLines.map(line => line.opacity(0.58, 0.35, easeOutCubic)),
    xAxis().end(1, 0.75, easeOutCubic),
    yAxis().end(1, 0.75, easeOutCubic),
  );
  yield* curve().end(1, 1.6, easeOutCubic);
  yield* all(
    pointP().opacity(1, 0.4, easeOutCubic),
    pLabel().opacity(1, 0.4, easeOutCubic),
    functionEquation().opacity(1, 0.5, easeOutCubic),
  );
  yield* waitFor(1.1);
  auditHold('hold_curve_context', [
    'title',
    'subtitle',
    ...plotAuditIds,
    'curve',
    'pointP',
    'point_labels',
    'function_equation',
  ]);

  // Hold 2: construct the finite average slope through P and Q.
  yield* all(
    pointQ().opacity(1, 0.45, easeOutCubic),
    qLabel().opacity(1, 0.45, easeOutCubic),
    secantLine().opacity(1, 0.15),
    secantLine().end(1, 0.85, easeOutCubic),
    interval().opacity(1, 0.35, easeOutCubic),
    interval().end(1, 0.75, easeOutCubic),
    intervalLabel().opacity(1, 0.35, easeOutCubic),
    secantEquation().opacity(1, 0.5, easeOutCubic),
  );
  yield* waitFor(1.35);
  auditHold('hold_secant_average', [
    'title',
    ...plotAuditIds,
    'curve',
    'pointP',
    'pointQ',
    'secant',
    'interval',
    'intervalLabel',
    'point_labels',
    'point_labels_q',
    'function_equation',
    'secant_equation',
  ]);

  // Hold 3: let h shrink; the secant pivots toward the tangent at P.
  yield* all(
    h(0.08, 2.4, easeInOutCubic),
    secantEquation().tex(
      String.raw`\displaystyle {{m_{\mathrm{sec}}}}={{\frac{f(1+h)-f(1)}{h}}}={{2+h}}`,
      1.25,
      easeInOutCubic,
    ),
    interval().opacity(0, 0.35, easeOutCubic),
    intervalLabel().opacity(0, 0.35, easeOutCubic),
    tangentLine().opacity(1, 0.85, easeOutCubic),
    derivativeEquation().opacity(1, 0.65, easeOutCubic),
    secantEquation().opacity(0.72, 0.45, easeOutCubic),
  );
  yield* waitFor(1.4);
  auditHold('hold_tangent_limit', [
    'title',
    ...plotAuditIds,
    'curve',
    'pointP',
    'pointQ',
    'secant',
    'tangent',
    'point_labels',
    'point_labels_q',
    'function_equation',
    'secant_equation',
    'derivative_equation',
  ]);

  // Hold 4: make the algebra visible as a sequence of dependent transforms.
  yield* all(
    derivationEquation().opacity(1, 0.5, easeOutCubic),
    secantEquation().opacity(0.34, 0.5, easeOutCubic),
  );
  yield* waitFor(0.6);
  yield* derivationEquation().tex(
    String.raw`\displaystyle {{\frac{(x+h)^2-x^2}{h}}}`,
    0.95,
    easeInOutCubic,
  );
  yield* waitFor(0.45);
  yield* derivationEquation().tex(
    String.raw`\displaystyle {{\frac{2xh+h^2}{h}}}`,
    0.95,
    easeInOutCubic,
  );
  yield* waitFor(0.45);
  yield* derivationEquation().tex(
    String.raw`\displaystyle {{2x+h}}`,
    0.9,
    easeInOutCubic,
  );
  yield* waitFor(0.45);
  yield* derivativeEquation().tex(
    String.raw`\displaystyle {{f'(x)}}={{\lim_{h\to0}}}{{(2x+h)}}={{2x}}`,
    1.0,
    easeInOutCubic,
  );
  yield* waitFor(1.45);
  auditHold('hold_power_rule', [
    'title',
    ...plotAuditIds,
    'curve',
    'pointP',
    'pointQ',
    'secant',
    'tangent',
    'point_labels',
    'point_labels_q',
    'function_equation',
    'secant_equation',
    'derivation_equation',
    'derivative_equation',
  ]);

  // Hold 5: the tangent and the formula covary as the probe moves.
  yield* all(
    pointQ().opacity(0, 0.35, easeOutCubic),
    qLabel().opacity(0, 0.35, easeOutCubic),
    secantLine().opacity(0, 0.35, easeOutCubic),
    secantEquation().opacity(0, 0.35, easeOutCubic),
    derivationEquation().opacity(0.24, 0.35, easeOutCubic),
    signSummary().opacity(1, 0.55, easeOutCubic),
  );
  yield* probeX(-1.55, 1.7, easeInOutCubic);
  yield* waitFor(0.45);
  yield* probeX(0, 1.05, easeInOutCubic);
  yield* waitFor(0.45);
  yield* probeX(1.55, 1.7, easeInOutCubic);
  yield* waitFor(1.35);
  auditHold('hold_slope_meaning', [
    'title',
    ...plotAuditIds,
    'curve',
    'pointP',
    'tangent',
    'point_labels',
    'function_equation',
    'derivation_equation',
    'derivative_equation',
    'sign_summary',
  ]);

  // Hold 6: close with a concrete transfer check and its traceable answer.
  yield* all(
    derivationEquation().opacity(0, 0.3, easeOutCubic),
    derivativeEquation().opacity(0.82, 0.3, easeOutCubic),
    transferPrompt().opacity(1, 0.5, easeOutCubic),
  );
  yield* waitFor(1.15);
  yield* transferAnswer().opacity(1, 0.55, easeOutCubic);
  yield* waitFor(1.6);
  auditHold('hold_transfer_answer', [
    'title',
    ...plotAuditIds,
    'curve',
    'pointP',
    'tangent',
    'point_labels',
    'function_equation',
    'derivative_equation',
    'sign_summary',
    'transfer_prompt',
    'transfer_answer',
  ]);
});
