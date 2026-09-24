/**
 * Build the component catalogue by introspecting the real compiled
 * declarations of `@ovacanvas/2d` and `@ovacanvas/core`.
 *
 * @remarks
 * This is the ManimWire idea applied to OvaCanvas: the vocabulary a model is
 * allowed to use is not hand-written prose, it is read out of the engine's own
 * types. A component, prop, easing or theme token that is not in the
 * declarations cannot appear in the catalogue, so it cannot pass validation.
 *
 * Usage: `node scripts/extract-catalogue.mjs` (writes
 * `src/catalogue/generated.ts`). `npm run catalogue -w packages/wire` does the
 * same. The catalogue test re-runs the extraction and fails if the checked-in
 * file is stale, so the two cannot drift apart silently.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import {fileURLToPath, pathToFileURL} from 'url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

/** Node subclasses that are not authorable scene content. */
const EXCLUDED_COMPONENTS = new Set([
  'View2D', // the stage itself
  'Shape', // abstract bases
  'Curve',
  'Bezier',
  'Camera', // editor-style camera rig, not beat content
  'Knot', // only meaningful as a Spline child
  'PortNode', // superseded by {ref, side} endpoints in the document model
  'Video', // needs a network/media source; beats must render offline
  'Img',
  'Icon',
]);

/** Props that are wiring, not content, and never belong in a document. */
const EXCLUDED_PROPS = new Set([
  'ref',
  'children',
  'key',
  'spawner',
  'shaders',
  'filters',
  'tagName',
  'layout',
  'compositeOperation',
  'drawHooks',
  'highlighter',
]);

/**
 * Base props worth surfacing to a model, grouped by the engine family that
 * owns them - a font size is essential on a Txt and noise on a Line.
 */
const ESSENTIAL_BY_FAMILY = [
  ['Node', ['position', 'x', 'y', 'rotation', 'scale', 'opacity', 'zIndex']],
  ['Layout', ['width', 'height', 'size']],
  ['Shape', ['fill', 'stroke', 'lineWidth', 'lineDash']],
  ['Curve', ['start', 'end', 'startArrow', 'endArrow', 'arrowSize', 'closed']],
  ['Rect', ['radius']],
  [
    'Txt',
    ['text', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'textAlign'],
  ],
  [
    'Latex',
    ['tex', 'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'textAlign'],
  ],
  ['Code', ['code', 'fontSize', 'fontFamily']],
];

function essentialPropsFor(chain) {
  const names = new Set();
  for (const [family, props] of ESSENTIAL_BY_FAMILY) {
    if (chain.includes(family)) props.forEach(prop => names.add(prop));
  }
  return names;
}

/** Declared type names mapped straight to a port kind. */
const NAMED_KINDS = new Map([
  ['PossibleColor', {kind: 'color'}],
  ['PossibleCanvasStyle', {kind: 'color'}],
  ['PossibleVector2', {kind: 'vector2'}],
  ['PossibleSpacing', {kind: 'spacing'}],
  ['Length', {kind: 'length'}],
  ['LengthLimit', {kind: 'length'}],
  ['FlexBasis', {kind: 'length'}],
  ['WireEndpoint', {kind: 'endpoint'}],
  ['Origin', {kind: 'origin'}],
]);

function createProgram() {
  const entries = [
    path.join(repoRoot, 'packages/2d/lib/index.d.ts'),
    path.join(repoRoot, 'packages/core/lib/index.d.ts'),
  ];
  for (const entry of entries) {
    if (!fs.existsSync(entry)) {
      throw new Error(
        `${entry} is missing - build the engine first (npm run core:build && npm run 2d:build)`,
      );
    }
  }
  const program = ts.createProgram(entries, {
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    target: ts.ScriptTarget.ES2020,
    skipLibCheck: true,
    experimentalDecorators: true,
  });
  return {program, entries};
}

function moduleExports(program, checker, file) {
  const sourceFile = program.getSourceFile(file);
  return checker.getExportsOfModule(checker.getSymbolAtLocation(sourceFile));
}

function resolveAlias(checker, symbol) {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function classChain(type) {
  const names = [];
  let current = type;
  while (current) {
    if (current.symbol?.name) names.push(current.symbol.name);
    current = current.getBaseTypes?.()?.[0];
  }
  return names;
}

function firstSentence(text) {
  const clean = text
    .replace(/\{@link\s+([^}\s|]+)(?:\s*\|\s*([^}]+))?\}/g, (_, a, b) => b ?? a)
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  const match = clean.match(/^(.+?[.!?])(\s|$)/);
  const sentence = match ? match[1] : clean;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
}

/**
 * Collect `@initial(...)` defaults from the 2d sources, keyed by
 * `ClassName.prop`, so the catalogue can say what an omitted prop becomes.
 */
function collectDefaults() {
  const defaults = new Map();
  const dirs = [path.join(repoRoot, 'packages/2d/src/lib')];
  const files = [];
  while (dirs.length) {
    const dir = dirs.pop();
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) dirs.push(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        files.push(full);
    }
  }
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.ES2020,
      true,
    );
    source.forEachChild(function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !member.name) continue;
          for (const decorator of ts.getDecorators(member) ?? []) {
            const call = decorator.expression;
            if (
              ts.isCallExpression(call) &&
              ts.isIdentifier(call.expression) &&
              call.expression.text === 'initial' &&
              call.arguments[0]
            ) {
              const text = call.arguments[0].getText(source);
              if (text.length <= 60)
                defaults.set(
                  `${node.name.text}.${member.name.getText(source)}`,
                  text,
                );
            }
          }
        }
      }
      node.forEachChild(visit);
    });
  }
  return defaults;
}

function isStringLiteralUnion(type) {
  const parts = type.isUnion() ? type.types : [type];
  const literals = [];
  let nullable = false;
  for (const part of parts) {
    if (part.isStringLiteral()) literals.push(part.value);
    else if (part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))
      nullable = true;
    else return null;
  }
  return literals.length ? {choices: literals, nullable} : null;
}

/**
 * Classify one prop's declared type into a port type, or `null` when the
 * type has no JSON representation a document could carry.
 */
function classify(checker, typeNode) {
  if (!typeNode) return null;
  // Unwrap SignalValue<T>: a document always supplies the plain value.
  if (
    ts.isTypeReferenceNode(typeNode) &&
    typeNode.typeName.getText() === 'SignalValue' &&
    typeNode.typeArguments?.length === 1
  ) {
    return classify(checker, typeNode.typeArguments[0]);
  }

  // `string[] | string`, `T | null` and friends.
  if (ts.isUnionTypeNode(typeNode)) {
    const members = typeNode.types.filter(
      t =>
        !(
          t.kind === ts.SyntaxKind.LiteralType &&
          t.literal.kind === ts.SyntaxKind.NullKeyword
        ) && t.kind !== ts.SyntaxKind.UndefinedKeyword,
    );
    const nullable = members.length !== typeNode.types.length;
    const texts = members.map(t => t.getText()).sort();
    if (texts.join('|') === 'string|string[]')
      return nullable ? {kind: 'tex', nullable: true} : {kind: 'tex'};
    if (members.length === 1) {
      const inner = classify(checker, members[0]);
      return inner ? {...inner, ...(nullable ? {nullable: true} : {})} : null;
    }
  }

  const text = typeNode.getText().replace(/\s+/g, ' ');
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (NAMED_KINDS.has(name)) return {...NAMED_KINDS.get(name)};
    if (name === 'Node') return {kind: 'node'};
    if (name === 'Scene3D') return {kind: 'node', component: 'Scene3D'};
  }
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return {kind: 'number'};
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return {kind: 'string'};
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return {kind: 'boolean'};
  if (text === 'number[]') return {kind: 'numbers'};
  if (text === 'SignalValue<PossibleVector2>[]') return {kind: 'points'};

  // Fixed-length number tuples, e.g. `readonly [longitude: number, latitude: number]`.
  const tuple = ts.isTypeOperatorNode(typeNode) ? typeNode.type : typeNode;
  if (ts.isTupleTypeNode(tuple)) {
    const allNumbers = tuple.elements.every(element => {
      const inner = ts.isNamedTupleMember(element) ? element.type : element;
      return inner.kind === ts.SyntaxKind.NumberKeyword;
    });
    if (allNumbers) return {kind: 'numbers', length: tuple.elements.length};
  }

  const resolved = checker.getTypeFromTypeNode(typeNode);
  const literalUnion = isStringLiteralUnion(resolved);
  if (literalUnion) {
    return {
      kind: 'enum',
      choices: literalUnion.choices,
      ...(literalUnion.nullable ? {nullable: true} : {}),
    };
  }

  // Structured engine specs (projections, geo sources, 3D worlds). They are
  // carried as JSON, and the TypeScript backstop checks their exact shape.
  if (
    ts.isTypeReferenceNode(typeNode) &&
    /^(Geo|Camera3D|SceneWorld3D|Vec3Like)/.test(typeNode.typeName.getText())
  ) {
    return {kind: 'json', tsType: typeNode.typeName.getText()};
  }
  return null;
}

function isTweenable(checker, member) {
  if (!member) return false;
  const type = checker.getTypeOfSymbol(member);
  return type
    .getCallSignatures()
    .some(
      signature =>
        signature.parameters.length >= 2 &&
        ['duration', 'time'].includes(signature.parameters[1].name),
    );
}

function memberDoc(checker, classType, name) {
  const member = checker.getPropertyOfType(classType, name);
  if (!member) return {member: undefined, doc: undefined};
  const doc = firstSentence(
    ts.displayPartsToString(member.getDocumentationComment(checker)),
  );
  return {member, doc};
}

export function extractCatalogue() {
  const {program, entries} = createProgram();
  const checker = program.getTypeChecker();
  const defaults = collectDefaults();
  const components = {};
  const skipped = {};

  for (const exported of moduleExports(program, checker, entries[0])) {
    const target = resolveAlias(checker, exported);
    if (!(target.flags & ts.SymbolFlags.Class)) continue;
    const name = exported.name;
    const instance = checker.getDeclaredTypeOfSymbol(target);
    const chain = classChain(instance);
    if (!chain.includes('Node') || EXCLUDED_COMPONENTS.has(name)) continue;

    const staticType = checker.getTypeOfSymbolAtLocation(
      target,
      target.valueDeclaration,
    );
    const param = staticType.getConstructSignatures()[0]?.getParameters()[0];
    if (!param) continue;
    const propsType = checker.getTypeOfSymbolAtLocation(
      param,
      param.valueDeclaration,
    );

    const essentialBase = essentialPropsFor(chain);
    const props = {};
    for (const prop of checker.getPropertiesOfType(propsType)) {
      if (EXCLUDED_PROPS.has(prop.name)) continue;
      const declaration = prop.declarations?.find(ts.isPropertySignature);
      const type = classify(checker, declaration?.type);
      if (!type) {
        (skipped[name] ??= []).push(prop.name);
        continue;
      }
      const owner = declaration.parent;
      const ownInterface =
        ts.isInterfaceDeclaration(owner) && owner.name.text === `${name}Props`;
      const {member, doc} = memberDoc(checker, instance, prop.name);
      const defaultText = chain
        .map(cls => defaults.get(`${cls}.${prop.name}`))
        .find(value => value !== undefined);
      props[prop.name] = {
        type,
        required: (prop.flags & ts.SymbolFlags.Optional) === 0,
        tweenable: isTweenable(checker, member),
        essential: ownInterface || essentialBase.has(prop.name),
        ...(defaultText !== undefined ? {default: defaultText} : {}),
        ...(doc ? {doc} : {}),
      };
    }

    const classDoc = firstSentence(
      ts.displayPartsToString(target.getDocumentationComment(checker)),
    );
    const isRoute = 'points' in props || ('from' in props && 'to' in props);
    components[name] = {
      name,
      extends: chain.slice(1),
      ...(classDoc ? {summary: classDoc} : {}),
      role: isRoute ? 'route' : 'item',
      props: Object.fromEntries(
        Object.entries(props).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  }

  // Easings: the core's exported timing functions.
  const easings = moduleExports(program, checker, entries[1])
    .map(symbol => symbol.name)
    .filter(name => /^(linear|ease(In|Out|InOut)[A-Z]\w*)$/.test(name))
    .sort();

  // Origin enum members, Theme keys and text roles, read from declarations.
  const exports2d = new Map(
    moduleExports(program, checker, entries[0]).map(s => [s.name, s]),
  );
  const origin = resolveAlias(checker, exports2d.get('Origin'));
  const origins = checker
    .getExportsOfModule(origin)
    .map(symbol => symbol.name)
    .filter(name => /^[A-Z]/.test(name));
  const themeType = checker.getDeclaredTypeOfSymbol(
    resolveAlias(checker, exports2d.get('Theme')),
  );
  const themeColors = checker.getPropertiesOfType(themeType).map(p => p.name);
  const typeScaleSymbol = resolveAlias(checker, exports2d.get('typeScale'));
  const typeScaleType = checker.getTypeOfSymbolAtLocation(
    typeScaleSymbol,
    typeScaleSymbol.valueDeclaration,
  );
  const textRoles = checker.getPropertiesOfType(typeScaleType).map(p => p.name);

  const version2d = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/2d/package.json'), 'utf8'),
  ).version;

  return {
    version: 1,
    engine: `@ovacanvas/2d@${version2d}`,
    components: Object.fromEntries(
      Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
    ),
    easings,
    origins,
    themeColors,
    textRoles,
    unsupportedProps: Object.fromEntries(
      Object.entries(skipped)
        .filter(([name]) => name in components)
        .map(([name, list]) => [name, [...new Set(list)].sort()]),
    ),
  };
}

export function renderCatalogueModule(catalogue) {
  return `// Generated by scripts/extract-catalogue.mjs from the compiled
// @ovacanvas/2d and @ovacanvas/core declarations. Do not edit by hand -
// run \`npm run catalogue -w packages/wire\` after changing the engine.
/* eslint-disable @typescript-eslint/naming-convention -- keys are engine component names */
import type {Catalogue} from './types.js';

export const GENERATED_CATALOGUE: Catalogue = ${JSON.stringify(catalogue, null, 2)};
`;
}

export const GENERATED_PATH = path.join(
  packageDir,
  'src/catalogue/generated.ts',
);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const catalogue = extractCatalogue();
  fs.writeFileSync(GENERATED_PATH, renderCatalogueModule(catalogue));
  const count = Object.keys(catalogue.components).length;
  const props = Object.values(catalogue.components).reduce(
    (sum, c) => sum + Object.keys(c.props).length,
    0,
  );
  console.log(
    `catalogue: ${count} components, ${props} props, ${catalogue.easings.length} easings -> ${path.relative(repoRoot, GENERATED_PATH)}`,
  );
}
