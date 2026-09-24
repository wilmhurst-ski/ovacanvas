import type {SceneNode, Touch} from '../document/model.js';
import {isObject} from '../document/values.js';
import {drawIcon} from '../icons/draw.js';
import {resolveIcon} from '../icons/library.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  mixedTextToTex,
  placementBox,
  wrapText,
} from './fields.js';
import {checkIconName} from './icon.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

interface Item {
  text?: string;
  tex?: string;
  detail?: string;
  /** An icon in place of the bullet, named in words. */
  icon?: string;
}

function parseItems(node: KitNode, errors?: FieldErrors): Item[] {
  if (!Array.isArray(node.items) || node.items.length === 0) {
    errors?.error(
      'items',
      'items is a non-empty list of strings or {"text"|"tex", "detail"?}',
    );
    return [];
  }
  return node.items.map((item, i) => {
    if (typeof item === 'string') return {text: item};
    if (
      isObject(item) &&
      (typeof item.text === 'string' || typeof item.tex === 'string')
    ) {
      if (item.detail !== undefined && typeof item.detail !== 'string') {
        errors?.error('items', `items[${i}].detail must be a string`);
      }
      return {
        ...(typeof item.text === 'string' ? {text: item.text} : {}),
        ...(typeof item.tex === 'string' ? {tex: item.tex} : {}),
        ...(typeof item.detail === 'string' ? {detail: item.detail} : {}),
        ...(typeof item.icon === 'string' ? {icon: item.icon} : {}),
      };
    }
    errors?.error(
      'items',
      `items[${i}] must be a string or {"text": "..."} / {"tex": "..."}`,
    );
    return {text: ''};
  });
}

export const list: KitSpec = {
  name: 'list',
  summary:
    'A list of short points or steps, numbered or bulleted, each optionally with a smaller detail line. Wrapping and spacing are handled for you. Words only in "text" - put math in "tex".',
  fields: {
    items: {
      type: '["point", {"text": "...", "detail"?: "...", "icon"?: "shield"}, {"tex": "E = mc^2"}]',
      required: true,
      doc: 'The points, in order.',
    },
    numbered: {
      type: 'boolean',
      doc: 'Numbers instead of bullets (default false).',
    },
    fontSize: {
      type: 'number',
      doc: 'Text size, default 32; shrinks to fit the region.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the list goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts: '"<id>.0", "<id>.1", ... one point (with its detail)',
  example: {
    id: 'causes',
    kit: 'list',
    region: 'right',
    numbered: true,
    items: [
      'Earth is tilted 23.5 degrees',
      {
        text: 'Sunlight hits one hemisphere more directly',
        detail: 'more energy per square metre',
      },
    ],
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(['items', 'numbered', 'fontSize', ...PLACEMENT_FIELDS]);
    checkPlacement(node, errors);
    if (node.numbered !== undefined && typeof node.numbered !== 'boolean') {
      errors.error('numbered', 'numbered is true or false');
    }
    if (
      node.fontSize !== undefined &&
      !(
        typeof node.fontSize === 'number' &&
        node.fontSize >= 18 &&
        node.fontSize <= 60
      )
    ) {
      errors.error('fontSize', 'fontSize is a number from 18 to 60');
    }
    parseItems(node, errors).forEach((item, i) => {
      if (item.icon !== undefined) {
        checkIconName(errors, `items.${i}`, item.icon);
      }
    });
    return errors.issues;
  },

  expand(node): KitExpansion {
    // A point written with maths in its words is typeset instead.
    const items = parseItems(node).map(item => {
      const tex = item.text !== undefined ? mixedTextToTex(item.text) : null;
      return tex && item.tex === undefined
        ? {tex, ...(item.detail !== undefined ? {detail: item.detail} : {})}
        : item;
    });
    const box = placementBox(node);
    const id = node.id;
    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const indent = 56;
    const textWidth = box.width - indent - 20;

    // Shrink the text until every wrapped line fits the box height.
    let size = typeof node.fontSize === 'number' ? node.fontSize : 32;
    const layoutAt = (s: number) =>
      items.map(item => ({
        lines: item.text !== undefined ? wrapText(item.text, s, textWidth) : [],
        detailLines: item.detail
          ? wrapText(item.detail, s * 0.72, textWidth)
          : [],
      }));
    const heightAt = (s: number) =>
      layoutAt(s).reduce(
        (sum, row, i) =>
          sum +
          Math.max(1, row.lines.length) * s * 1.35 +
          (items[i].tex ? s * 0.6 : 0) +
          row.detailLines.length * s * 0.72 * 1.35 +
          s * 0.8,
        0,
      );
    while (size > 18 && heightAt(size) > box.height) size -= 2;
    const rows = layoutAt(size);

    let y = box.y - Math.min(box.height, heightAt(size)) / 2;
    const leftX = box.x - box.width / 2;
    items.forEach((item, i) => {
      const partNodes: string[] = [];
      const lineHeight = size * 1.35;
      const firstY = y + lineHeight / 2;
      const markerId = `${id}_m${i}`;
      const iconDef = item.icon ? resolveIcon(item.icon) : null;
      let markers = [markerId];
      if (iconDef) {
        // An icon stands in for the bullet: the point's own picture.
        const drawn = drawIcon(markerId, iconDef, [leftX + 24, firstY], {
          size: Math.round(size * 1.2),
          style: 'line',
          color: 'blue',
        });
        nodes.push(...drawn.nodes);
        touches.push(...drawn.touches);
        markers = drawn.ids;
      } else if (node.numbered) {
        nodes.push({
          id: markerId,
          component: 'Txt',
          props: {
            text: `${i + 1}.`,
            fontSize: size,
            fontWeight: 700,
            fill: {theme: 'blue'},
            position: [Math.round(leftX + 22), Math.round(firstY)],
          },
        });
      } else {
        nodes.push({
          id: markerId,
          component: 'Circle',
          props: {
            size: Math.round(size * 0.3),
            fill: {theme: 'blue'},
            position: [Math.round(leftX + 22), Math.round(firstY)],
          },
        });
      }
      partNodes.push(...markers);
      if (item.tex !== undefined) {
        const texId = `${id}_x${i}`;
        const texHeight = lineHeight + size * 0.6;
        nodes.push({
          id: texId,
          component: 'Latex',
          props: {
            tex: item.tex,
            fontSize: size,
            // Left-aligned with the text of the other points: anchored by
            // its left edge, so no width has to be guessed.
            offset: [-1, 0],
            position: [
              Math.round(leftX + indent),
              Math.round(y + texHeight / 2),
            ],
          },
        });
        partNodes.push(texId);
        y += texHeight;
      }
      rows[i].lines.forEach((line, k) => {
        const lineId = `${id}_t${i}_${k}`;
        // Left-aligned: a Txt is centred on its position, so offset by half its width.
        nodes.push({
          id: lineId,
          component: 'Txt',
          props: {
            text: line,
            fontSize: size,
            textAlign: 'left',
            position: [
              Math.round(leftX + indent + textWidth / 2),
              Math.round(y + lineHeight / 2),
            ],
            width: Math.round(textWidth),
          },
        });
        partNodes.push(lineId);
        y += lineHeight;
      });
      rows[i].detailLines.forEach((line, k) => {
        const detailId = `${id}_d${i}_${k}`;
        const detailHeight = size * 0.72 * 1.35;
        nodes.push({
          id: detailId,
          component: 'Txt',
          props: {
            text: line,
            fontSize: Math.round(size * 0.72),
            fill: {theme: 'secondaryInk'},
            textAlign: 'left',
            position: [
              Math.round(leftX + indent + textWidth / 2),
              Math.round(y + detailHeight / 2),
            ],
            width: Math.round(textWidth),
          },
        });
        partNodes.push(detailId);
        y += detailHeight;
      });
      y += size * 0.8;
      // One point's lines are a single block of text, drawn close on purpose.
      const lines = partNodes.slice(markers.length);
      lines.forEach((a, k) => {
        for (const b of lines.slice(k + 1)) {
          touches.push({a, b, reason: 'lines of one point'});
        }
      });
      // A number ("1.") is as wide as a short word and sits just before its
      // text; it labels that point, so the two may be close.
      if (node.numbered || iconDef) {
        for (const marker of markers) {
          for (const line of lines) {
            touches.push({
              a: marker,
              b: line,
              reason: 'the marker of its point',
            });
          }
        }
      }
      parts.set(String(i), {nodes: partNodes});
    });
    return {nodes, touches, parts};
  },
};

export const title: KitSpec = {
  name: 'title',
  summary:
    'The heading of a beat, with an optional subtitle, at the standard position at the top of the stage.',
  fields: {
    text: {type: 'string', required: true, doc: 'The heading, in words.'},
    subtitle: {type: 'string', doc: 'A smaller line under it.'},
  },
  parts: '"<id>.text", "<id>.subtitle"',
  example: {
    id: 'heading',
    kit: 'title',
    text: 'Why we have seasons',
    subtitle: 'It is the tilt, not the distance',
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(['text', 'subtitle']);
    if (typeof node.text !== 'string' || !node.text.trim()) {
      errors.error('text', 'text is the heading, a non-empty string');
    }
    if (node.subtitle !== undefined && typeof node.subtitle !== 'string') {
      errors.error('subtitle', 'subtitle is a string');
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const id = node.id;
    // A heading with maths in it ("The surface z = x^2 + y^2") is typeset.
    const headingTex = mixedTextToTex(String(node.text));
    const nodes: SceneNode[] = [
      headingTex
        ? {
            id: `${id}_h`,
            component: 'Latex',
            props: {
              tex: headingTex,
              fontSize: 60,
              position: [0, node.subtitle ? -420 : -400],
            },
          }
        : {
            id: `${id}_h`,
            component: 'Txt',
            role: 'title',
            props: {
              text: String(node.text),
              position: [0, node.subtitle ? -420 : -400],
            },
          },
    ];
    const parts = new Map<string, KitPart>([['text', {nodes: [`${id}_h`]}]]);
    if (typeof node.subtitle === 'string' && node.subtitle) {
      const subtitleTex = mixedTextToTex(node.subtitle);
      nodes.push(
        subtitleTex
          ? {
              id: `${id}_s`,
              component: 'Latex',
              props: {
                tex: subtitleTex,
                fontSize: 32,
                fill: {theme: 'secondaryInk'},
                position: [0, -352],
              },
            }
          : {
              id: `${id}_s`,
              component: 'Txt',
              role: 'subtitle',
              props: {
                text: node.subtitle,
                fill: {theme: 'secondaryInk'},
                position: [0, -352],
              },
            },
      );
      parts.set('subtitle', {nodes: [`${id}_s`]});
    }
    return {nodes, touches: [], parts};
  },
};
