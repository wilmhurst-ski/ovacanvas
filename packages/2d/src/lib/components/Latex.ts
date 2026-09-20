import {
  lazy,
  SerializedVector2,
  Signal,
  SignalValue,
  SimpleSignal,
  threadable,
  TimingFunction,
  Vector2,
} from '@ovacanvas/core';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html';
import {TeX} from 'mathjax-full/js/input/tex';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages';
import {mathjax} from 'mathjax-full/js/mathjax';
import {SVG} from 'mathjax-full/js/output/svg';
import {OptionList} from 'mathjax-full/js/util/Options';
import {computed, initial, parser, signal} from '../decorators';
import {theme} from '../theme/theme';
import {Node} from './Node';
import {
  SVGDocument,
  SVGDocumentData,
  SVG as SVGNode,
  SVGProps,
  SVGShapeData,
} from './SVG';

const Adaptor = liteAdaptor();
RegisterHTMLHandler(Adaptor);

const JaxDocument = mathjax.document('', {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  InputJax: new TeX({packages: AllPackages}),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  OutputJax: new SVG({fontCache: 'local'}),
});

export interface LatexProps extends Omit<SVGProps, 'svg'> {
  tex?: SignalValue<string[] | string>;
  renderProps?: SignalValue<OptionList>;
}

/**
 * A node for animating equations with LaTeX.
 *
 * @preview
 * ```tsx editor
 * import {Latex, makeScene2D} from '@ovacanvas/2d';
 * import {createRef, waitFor} from '@ovacanvas/core';
 *
 * export default makeScene2D(function* (view) {
 *   const tex = createRef<Latex>();
 *   view.add(<Latex ref={tex} tex="{{y=}}{{a}}{{x^2}}" fill="white" />);
 *
 *   yield* waitFor(0.2);
 *   yield* tex().tex('{{y=}}{{a}}{{x^2}} + {{bx}}', 1);
 *   yield* waitFor(0.2);
 *   yield* tex().tex(
 *     '{{y=}}{{\\left(}}{{a}}{{x^2}} + {{bx}}{{\\over 1}}{{\\right)}}',
 *     1,
 *   );
 *   yield* waitFor(0.2);
 *   yield* tex().tex('{{y=}}{{a}}{{x^2}}', 1);
 * });
 * ```
 */
export class Latex extends SVGNode {
  @lazy(() => {
    return parseFloat(
      window.getComputedStyle(SVGNode.containerElement).fontSize,
    );
  })
  private static containerFontSize: number;
  private static svgContentsPool: Record<string, string> = {};
  private static texNodesPool: Record<string, SVGDocumentData> = {};
  /**
   * Which `{{...}}` fragments produced a given SVG string.
   *
   * @remarks
   * **Static, and that is the fix for a real defect.** This used to be an
   * instance field, populated by `texToSvg` and read back by `parseSVG` on the
   * same instance. That invariant does not hold: `svgContentsPool` above is
   * static, so an SVG string can reach `parseSVG` on an instance that never
   * called `texToSvg` for it - which is exactly what happens when a scene
   * generator is re-executed and a fresh `Latex` node is built for the same
   * equation. The lookup returned `undefined`, `parseSVG` threw, and the throw
   * was swallowed inside a `@computed`, so the node rendered at **0x0 with no
   * error anywhere**: a scene's equation silently vanished on every backward
   * seek, and nothing in the logs said why.
   *
   * The mapping is a property of the markup, not of the node that happens to
   * have parsed it, so it belongs in the same static pool that produces that
   * markup.
   */
  private static svgSubTexMap: Record<string, string[]> = {};

  @initial({})
  @signal()
  public declare readonly options: SimpleSignal<OptionList, this>;

  @initial('')
  @parser(function (this: SVGNode, value: string[] | string): string[] {
    const array = typeof value === 'string' ? [value] : value;
    return array
      .reduce<string[]>((prev, current) => {
        prev.push(...current.split(/{{(.*?)}}/));
        return prev;
      }, [])
      .filter(sub => sub.trim().length > 0);
  })
  @signal()
  public declare readonly tex: Signal<string[] | string, string[], this>;

  public constructor(props: LatexProps) {
    super({
      fontSize: 48,
      ...props,
      svg: '',
    });
    this.svg(this.latexSVG);

    // Build the document NOW, while the scene context is guaranteed present.
    //
    // @remarks
    // The constructor runs inside the scene generator, which is the one place
    // a scene context is definitely active - and building an SVG document
    // constructs real scene nodes, which requires one. Evaluated later (during
    // layout, say) the first build can land outside any context, throw "The
    // scene is not available in the current context", and because `document()`
    // is a memoized computed the throw is swallowed and the failure cached:
    // the node then renders at 0x0 forever with no error in any log.
    //
    // That is exactly what happened to a `Latex` node rebuilt by a scene
    // generator re-execution (any backward seek), and it made an equation
    // vanish silently on every loop. Forcing the build here costs one parse
    // that would otherwise happen lazily a moment later.
    this.document();
  }

  /**
   * Defaults an equation's fill to the theme's `ink`, the same fallback
   * `Txt` uses and for the same reason: `Shape.fill` itself has no default,
   * so a bare `new Latex({tex: '...'})` would otherwise inherit whatever
   * `fillStyle` the canvas context happened to be left at, not a real,
   * intentional color.
   */
  protected getDefaultFill(initial: unknown) {
    return initial ?? theme().ink;
  }

  protected override calculateWrapperScale(
    documentSize: Vector2,
    parentSize: SerializedVector2<number | null>,
  ): Vector2 {
    if (parentSize.x || parentSize.y) {
      return super.calculateWrapperScale(documentSize, parentSize);
    }
    return new Vector2(this.fontSize() / Latex.containerFontSize);
  }

  @computed()
  protected latexSVG() {
    return this.texToSvg(this.tex());
  }

  private getNodeCharacterId({id}: SVGShapeData) {
    if (!id.includes('-')) return id;
    return id.substring(id.lastIndexOf('-') + 1);
  }

  protected override parseSVG(svg: string): SVGDocument {
    const subTexs = Latex.svgSubTexMap[svg]?.map(sub => sub.trim());
    if (!subTexs) {
      // Fail loudly rather than with a `TypeError` from a non-null assertion:
      // this used to surface as "cannot read properties of undefined" from a
      // computed, which the renderer swallows, leaving a zero-sized node and
      // no explanation anywhere. A named error at least says what broke.
      throw new Error(
        `Latex ${this.key}: no sub-expression mapping for its own SVG output. ` +
          'The SVG cache and the fragment map have gone out of sync.',
      );
    }
    const key = `[${subTexs.join(',')}]::${JSON.stringify(this.options())}`;
    const cached = Latex.texNodesPool[key];
    if (cached && (cached.size.x > 0 || cached.size.y > 0)) {
      return this.buildDocument(Latex.texNodesPool[key]);
    }
    const oldSVG = SVGNode.parseSVGData(svg);
    const oldNodes = [...oldSVG.nodes];

    const newNodes: SVGShapeData[] = [];
    for (const sub of subTexs) {
      const subSvg = this.subTexToSVG(sub);
      const subNodes = SVGNode.parseSVGData(subSvg).nodes;

      if (subNodes.length === 0) {
        continue;
      }

      const firstId = this.getNodeCharacterId(subNodes[0]);
      const spliceIndex = oldNodes.findIndex(
        node => this.getNodeCharacterId(node) === firstId,
      );
      const children = oldNodes.splice(spliceIndex, subNodes.length);

      if (children.length === 1) {
        newNodes.push({
          ...children[0],
          id: sub,
        });
        continue;
      }

      newNodes.push({
        id: sub,
        type: Node,
        props: {},
        children,
      });
    }
    if (oldNodes.length > 0) {
      // A leftover node means a `{{sub}}` fragment didn't line up with the
      // full tex string it was split from - the sign of a scene author
      // hand-splitting an equation in a way that doesn't reconstruct it (a
      // dropped brace, a fragment that isn't a real substring of the whole).
      // Logging and continuing used to ship a silently mismatched/misaligned
      // equation; throwing surfaces it as a real, gate-visible failure
      // instead of a visual that quietly renders wrong.
      throw new Error(
        `Latex ${this.key}: matching between the full tex and its {{...}} parts failed ` +
          `(${oldNodes.length} SVG node(s) never matched to a sub-expression)`,
      );
    }

    const newSVG: SVGDocumentData = {
      size: oldSVG.size,
      nodes: newNodes,
    };
    Latex.texNodesPool[key] = newSVG;
    return this.buildDocument(newSVG);
  }

  private texToSvg(subTexs: string[]) {
    const singleTex = subTexs.join('');
    const svg = this.singleTexToSVG(singleTex);
    Latex.svgSubTexMap[svg] = subTexs;
    return svg;
  }

  private subTexToSVG(subTex: string) {
    let tex = subTex.trim();
    if (
      ['\\overline', '\\sqrt', '\\sqrt{'].includes(tex) ||
      tex.endsWith('_') ||
      tex.endsWith('^') ||
      tex.endsWith('dot')
    ) {
      tex += '{\\quad}';
    }

    if (tex === '\\substack') tex = '\\quad';

    const numLeft = tex.match(/\\left[()[\]|.\\]/g)?.length ?? 0;
    const numRight = tex.match(/\\right[()[\]|.\\]/g)?.length ?? 0;
    if (numLeft !== numRight) {
      tex = tex.replace(/\\left/g, '\\big').replace(/\\right/g, '\\big');
    }

    const bracesLeft = tex.match(/((?<!\\)|(?<=\\\\)){/g)?.length ?? 0;
    const bracesRight = tex.match(/((?<!\\)|(?<=\\\\))}/g)?.length ?? 0;

    if (bracesLeft < bracesRight) {
      tex = '{'.repeat(bracesRight - bracesLeft) + tex;
    } else if (bracesRight < bracesLeft) {
      tex += '}'.repeat(bracesLeft - bracesRight);
    }

    const hasArrayBegin = tex.includes('\\begin{array}');
    const hasArrayEnd = tex.includes('\\end{array}');
    if (hasArrayBegin !== hasArrayEnd) tex = '';

    return this.singleTexToSVG(tex);
  }

  private singleTexToSVG(tex: string): string {
    const src = `${tex}::${JSON.stringify(this.options())}`;
    if (Latex.svgContentsPool[src]) {
      return Latex.svgContentsPool[src];
    }

    const svg = Adaptor.innerHTML(JaxDocument.convert(tex, this.options()));
    if (svg.includes('data-mjx-error')) {
      const errors = svg.match(/data-mjx-error="(.*?)"/);
      // MathJax renders an inline error glyph and keeps going rather than
      // throwing itself - left alone, that error glyph is what would have
      // shipped as the equation. Fail loud instead of caching and returning
      // a visibly broken render.
      throw new Error(
        `Invalid MathJax in "${tex}": ${errors?.[1] ?? 'unknown error'}`,
      );
    }
    Latex.svgContentsPool[src] = svg;
    return svg;
  }

  @threadable()
  protected *tweenTex(
    value: string[],
    time: number,
    timingFunction: TimingFunction,
  ) {
    const newSVG = this.texToSvg(this.tex.context.parse(value));
    yield* this.svg(newSVG, time, timingFunction);
    this.svg(this.latexSVG);
  }
}
