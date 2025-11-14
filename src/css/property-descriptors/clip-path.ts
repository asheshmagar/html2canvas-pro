import { IPropertyValueDescriptor, PropertyDescriptorParsingType } from '../IPropertyDescriptor';
import { CSSFunction, CSSValue, isIdentToken } from '../syntax/parser';
import { TokenType } from '../syntax/tokenizer';
import { Context } from '../../core/context';
import { Path } from '../../render/path';
import { Vector } from '../../render/vector';
import { BezierCurve } from '../../render/bezier-curve';
import { LengthPercentage, isLengthPercentage } from '../types/length-percentage';
import { getAbsoluteValue } from '../types/length-percentage';

export interface ClipPathFunction {
    name: string;
    args: CSSValue[];
}

export interface ClipPathURL {
    type: 'url';
    url: string;
    id: string;
}

export type ClipPath = ClipPathFunction | ClipPathURL | null;

export const clipPath: IPropertyValueDescriptor<ClipPath> = {
    name: 'clip-path',
    initialValue: 'none',
    prefix: false,
    type: PropertyDescriptorParsingType.VALUE,
    parse: (_context: Context, token: CSSValue) => {
        if (isIdentToken(token) && token.value === 'none') {
            return null;
        }

        if (token.type === TokenType.URL_TOKEN) {
            // Extract ID from url(#id) format
            const urlValue = token.value;
            const idMatch = urlValue.match(/#([^)]+)/);
            if (idMatch && idMatch[1]) {
                return {
                    type: 'url',
                    url: urlValue,
                    id: idMatch[1]
                };
            }
            return null;
        }

        if (token.type === TokenType.FUNCTION) {
            const func = token as CSSFunction;
            if (SUPPORTED_CLIP_FUNCTIONS.hasOwnProperty(func.name)) {
                return {
                    name: func.name,
                    args: func.values
                };
            }
            // Unsupported clip-path function, return null (no clipping)
            return null;
        }

        return null;
    }
};

// Convert clip-path function to Path array using element dimensions
export const clipPathToPaths = (clipPath: ClipPath, elementWidth: number, elementHeight: number): Path[] | null => {
    if (clipPath === null) {
        return null;
    }

    // Handle URL references to SVG clipPath
    if ('type' in clipPath && clipPath.type === 'url') {
        return svgClipPathToPaths(clipPath.id, elementWidth, elementHeight);
    }

    // Handle function-based clip-paths
    if ('name' in clipPath) {
        const converter = SUPPORTED_CLIP_FUNCTIONS[clipPath.name];
        if (!converter) {
            return null;
        }
        return converter(clipPath.args, elementWidth, elementHeight);
    }

    return null;
};

// Convert SVG clipPath element to Path array
const svgClipPathToPaths = (clipPathId: string, elementWidth: number, elementHeight: number): Path[] | null => {
    if (typeof window === 'undefined' || !window.document) {
        return null;
    }

    const clipPathElement = window.document.getElementById(clipPathId) as SVGClipPathElement | null;
    if (!clipPathElement || clipPathElement.tagName !== 'clipPath') {
        return null;
    }

    // Check clipPathUnits attribute (defaults to objectBoundingBox)
    const clipPathUnitsAttr = clipPathElement.getAttribute('clipPathUnits');
    const isObjectBoundingBox = !clipPathUnitsAttr || clipPathUnitsAttr === 'objectBoundingBox';

    const paths: Path[] = [];
    const children = clipPathElement.children;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childPaths = convertSVGElementToPaths(child, elementWidth, elementHeight, isObjectBoundingBox);
        if (childPaths && childPaths.length > 0) {
            paths.push(...childPaths);
        }
    }

    return paths.length > 0 ? paths : null;
};

// Convert individual SVG element to Path array
const convertSVGElementToPaths = (
    element: Element,
    elementWidth: number,
    elementHeight: number,
    isObjectBoundingBox: boolean
): Path[] | null => {
    const tagName = element.tagName.toLowerCase();

    switch (tagName) {
        case 'circle': {
            const circle = element as SVGCircleElement;
            const cx = parseFloat(circle.getAttribute('cx') || '0.5');
            const cy = parseFloat(circle.getAttribute('cy') || '0.5');
            const r = parseFloat(circle.getAttribute('r') || '0.5');

            const centerX = isObjectBoundingBox ? cx * elementWidth : cx;
            const centerY = isObjectBoundingBox ? cy * elementHeight : cy;
            const radius = isObjectBoundingBox ? r * Math.min(elementWidth, elementHeight) : r;

            return createCirclePath(centerX, centerY, radius);
        }

        case 'ellipse': {
            const ellipse = element as SVGEllipseElement;
            const cx = parseFloat(ellipse.getAttribute('cx') || '0.5');
            const cy = parseFloat(ellipse.getAttribute('cy') || '0.5');
            const rx = parseFloat(ellipse.getAttribute('rx') || '0.5');
            const ry = parseFloat(ellipse.getAttribute('ry') || '0.5');

            const centerX = isObjectBoundingBox ? cx * elementWidth : cx;
            const centerY = isObjectBoundingBox ? cy * elementHeight : cy;
            const radiusX = isObjectBoundingBox ? rx * elementWidth : rx;
            const radiusY = isObjectBoundingBox ? ry * elementHeight : ry;

            return createEllipsePath(centerX, centerY, radiusX, radiusY);
        }

        case 'rect': {
            const rect = element as SVGRectElement;
            const x = parseFloat(rect.getAttribute('x') || '0');
            const y = parseFloat(rect.getAttribute('y') || '0');
            const width = parseFloat(rect.getAttribute('width') || '1');
            const height = parseFloat(rect.getAttribute('height') || '1');
            const rx = parseFloat(rect.getAttribute('rx') || '0');
            const ry = parseFloat(rect.getAttribute('ry') || '0');

            const x1 = isObjectBoundingBox ? x * elementWidth : x;
            const y1 = isObjectBoundingBox ? y * elementHeight : y;
            const w = isObjectBoundingBox ? width * elementWidth : width;
            const h = isObjectBoundingBox ? height * elementHeight : height;
            const borderRadiusX = isObjectBoundingBox ? rx * elementWidth : rx;
            const borderRadiusY = isObjectBoundingBox ? ry * elementHeight : ry;

            return createRectPath(x1, y1, w, h, borderRadiusX, borderRadiusY);
        }

        case 'polygon': {
            const polygon = element as SVGPolygonElement;
            const points = polygon.points;
            const pathPoints: Vector[] = [];

            for (let i = 0; i < points.numberOfItems; i++) {
                const point = points.getItem(i);
                const x = isObjectBoundingBox ? point.x * elementWidth : point.x;
                const y = isObjectBoundingBox ? point.y * elementHeight : point.y;
                pathPoints.push(new Vector(x, y));
            }

            return pathPoints.length >= 3 ? pathPoints : null;
        }

        case 'polyline': {
            const polyline = element as SVGPolylineElement;
            const points = polyline.points;
            const pathPoints: Vector[] = [];

            for (let i = 0; i < points.numberOfItems; i++) {
                const point = points.getItem(i);
                const x = isObjectBoundingBox ? point.x * elementWidth : point.x;
                const y = isObjectBoundingBox ? point.y * elementHeight : point.y;
                pathPoints.push(new Vector(x, y));
            }

            return pathPoints.length >= 2 ? pathPoints : null;
        }

        case 'path': {
            const path = element as SVGPathElement;
            const d = path.getAttribute('d');
            if (!d) {
                return null;
            }
            return parseSVGPath(d, elementWidth, elementHeight, isObjectBoundingBox);
        }

        default:
            return null;
    }
};

// Create circle path from center and radius
const createCirclePath = (centerX: number, centerY: number, radius: number): Path[] => {
    const segments = 32;
    const points: Vector[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        points.push(new Vector(x, y));
    }
    return points;
};

// Create ellipse path from center and radii
const createEllipsePath = (centerX: number, centerY: number, radiusX: number, radiusY: number): Path[] => {
    const segments = 32;
    const points: Vector[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = centerX + radiusX * Math.cos(angle);
        const y = centerY + radiusY * Math.sin(angle);
        points.push(new Vector(x, y));
    }
    return points;
};

// Create rectangle path with optional rounded corners
const createRectPath = (x: number, y: number, width: number, height: number, rx: number, ry: number): Path[] => {
    const x1 = x;
    const y1 = y;
    const x2 = x + width;
    const y2 = y + height;
    const borderRadiusX = Math.min(rx, width / 2);
    const borderRadiusY = Math.min(ry, height / 2);

    if (borderRadiusX > 0 || borderRadiusY > 0) {
        const r = Math.max(borderRadiusX, borderRadiusY);
        const kappa = 4 * ((Math.sqrt(2) - 1) / 3);
        const ox = r * kappa;
        const oy = r * kappa;

        return [
            new BezierCurve(
                new Vector(x1, y1 + r),
                new Vector(x1, y1 + r - oy),
                new Vector(x1 + r - ox, y1),
                new Vector(x1 + r, y1)
            ),
            new BezierCurve(
                new Vector(x2 - r, y1),
                new Vector(x2 - r + ox, y1),
                new Vector(x2, y1 + r - oy),
                new Vector(x2, y1 + r)
            ),
            new BezierCurve(
                new Vector(x2, y2 - r),
                new Vector(x2, y2 - r + oy),
                new Vector(x2 - r + ox, y2),
                new Vector(x2 - r, y2)
            ),
            new BezierCurve(
                new Vector(x1 + r, y2),
                new Vector(x1 + r - ox, y2),
                new Vector(x1, y2 - r + oy),
                new Vector(x1, y2 - r)
            )
        ];
    } else {
        return [new Vector(x1, y1), new Vector(x2, y1), new Vector(x2, y2), new Vector(x1, y2)];
    }
};

// Parse SVG path data string
const parseSVGPath = (
    d: string,
    elementWidth: number,
    elementHeight: number,
    isObjectBoundingBox: boolean
): Path[] | null => {
    // Simple path parser - handles basic commands (M, L, Z, C, Q)
    // This is a simplified version; full SVG path parsing is more complex
    const commands = d.match(/[MLZCHVQTCSAZmlzchvtcqsa][^MLZCHVQTCSAZmlzchvtcqsa]*/gi) || [];
    const points: Vector[] = [];
    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;

    for (const command of commands) {
        const cmd = command[0];
        const coords = command
            .slice(1)
            .trim()
            .split(/[\s,]+/)
            .filter((s) => s.length > 0)
            .map((s) => parseFloat(s));

        const isAbsolute = cmd === cmd.toUpperCase();
        const cmdLower = cmd.toLowerCase();

        switch (cmdLower) {
            case 'm': // Move to
                if (coords.length >= 2) {
                    if (isAbsolute) {
                        currentX = coords[0];
                        currentY = coords[1];
                        startX = currentX;
                        startY = currentY;
                    } else {
                        currentX += coords[0];
                        currentY += coords[1];
                        if (points.length === 0) {
                            startX = currentX;
                            startY = currentY;
                        }
                    }
                    const x = isObjectBoundingBox ? currentX * elementWidth : currentX;
                    const y = isObjectBoundingBox ? currentY * elementHeight : currentY;
                    points.push(new Vector(x, y));
                }
                break;

            case 'l': // Line to
                if (coords.length >= 2) {
                    if (isAbsolute) {
                        currentX = coords[0];
                        currentY = coords[1];
                    } else {
                        currentX += coords[0];
                        currentY += coords[1];
                    }
                    const x = isObjectBoundingBox ? currentX * elementWidth : currentX;
                    const y = isObjectBoundingBox ? currentY * elementHeight : currentY;
                    points.push(new Vector(x, y));
                }
                break;

            case 'z': // Close path
                if (points.length > 0 && (currentX !== startX || currentY !== startY)) {
                    // Path is already closed by returning to start
                }
                break;

            case 'c': // Cubic Bezier
                if (coords.length >= 6) {
                    // For simplicity, we'll approximate bezier curves with line segments
                    // In a full implementation, we'd create BezierCurve objects
                    // Use the end point of the bezier curve
                    if (isAbsolute) {
                        currentX = coords[4];
                        currentY = coords[5];
                    } else {
                        currentX += coords[4];
                        currentY += coords[5];
                    }
                    const x = isObjectBoundingBox ? currentX * elementWidth : currentX;
                    const y = isObjectBoundingBox ? currentY * elementHeight : currentY;
                    points.push(new Vector(x, y));
                }
                break;

            case 'h': // Horizontal line
                if (coords.length >= 1) {
                    if (isAbsolute) {
                        currentX = coords[0];
                    } else {
                        currentX += coords[0];
                    }
                    const x = isObjectBoundingBox ? currentX * elementWidth : currentX;
                    const y = isObjectBoundingBox ? currentY * elementHeight : currentY;
                    points.push(new Vector(x, y));
                }
                break;

            case 'v': // Vertical line
                if (coords.length >= 1) {
                    if (isAbsolute) {
                        currentY = coords[0];
                    } else {
                        currentY += coords[0];
                    }
                    const x = isObjectBoundingBox ? currentX * elementWidth : currentX;
                    const y = isObjectBoundingBox ? currentY * elementHeight : currentY;
                    points.push(new Vector(x, y));
                }
                break;
        }
    }

    return points.length >= 2 ? points : null;
};

// Parse polygon() function: polygon([fill-rule,] x1 y1, x2 y2, ...)
const polygon = (args: CSSValue[], elementWidth: number, elementHeight: number): Path[] => {
    const points: Vector[] = [];
    let currentX: LengthPercentage | null = null;
    let argIndex = 0;

    // Skip optional fill-rule (evenodd or nonzero) if present
    if (args.length > 0 && isIdentToken(args[0]) && (args[0].value === 'evenodd' || args[0].value === 'nonzero')) {
        argIndex = 1;
    }

    for (let i = argIndex; i < args.length; i++) {
        const arg = args[i];
        if (isLengthPercentage(arg)) {
            if (currentX === null) {
                currentX = arg as LengthPercentage;
            } else {
                const x = getAbsoluteValue(currentX, elementWidth);
                const y = getAbsoluteValue(arg as LengthPercentage, elementHeight);
                points.push(new Vector(x, y));
                currentX = null;
            }
        }
    }

    if (points.length < 3) {
        return [];
    }

    // Convert points to Path array (closed polygon)
    return points;
};

// Parse circle() function: circle(radius at x y)
const circle = (args: CSSValue[], elementWidth: number, elementHeight: number): Path[] => {
    // Default radius is closest-side (distance to nearest edge)
    const defaultRadius = Math.min(elementWidth, elementHeight) / 2;
    let radius: number = defaultRadius;
    let centerX: number = elementWidth / 2;
    let centerY: number = elementHeight / 2;
    let foundAt = false;
    let hasRadius = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (isIdentToken(arg)) {
            if (arg.value === 'at') {
                foundAt = true;
                continue;
            } else if (arg.value === 'closest-side') {
                radius = Math.min(elementWidth, elementHeight) / 2;
                hasRadius = true;
                continue;
            } else if (arg.value === 'farthest-side') {
                radius = Math.max(elementWidth, elementHeight) / 2;
                hasRadius = true;
                continue;
            }
        }

        if (isLengthPercentage(arg)) {
            if (!foundAt && !hasRadius) {
                // This is the radius
                radius = getAbsoluteValue(arg as LengthPercentage, Math.min(elementWidth, elementHeight));
                hasRadius = true;
            } else if (foundAt) {
                // This is center position
                if (i < args.length - 1 && isLengthPercentage(args[i + 1])) {
                    centerX = getAbsoluteValue(arg as LengthPercentage, elementWidth);
                    centerY = getAbsoluteValue(args[i + 1] as LengthPercentage, elementHeight);
                    i++; // Skip next token
                } else {
                    centerX = getAbsoluteValue(arg as LengthPercentage, elementWidth);
                }
            }
        }
    }

    // Approximate circle with polygon (32 segments for smooth circle)
    const segments = 32;
    const points: Vector[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        points.push(new Vector(x, y));
    }
    return points;
};

// Parse ellipse() function: ellipse(rx ry at x y)
const ellipse = (args: CSSValue[], elementWidth: number, elementHeight: number): Path[] => {
    // Default radii are closest-side
    let radiusX: number = elementWidth / 2;
    let radiusY: number = elementHeight / 2;
    let centerX: number = elementWidth / 2;
    let centerY: number = elementHeight / 2;
    let foundAt = false;
    let radiusCount = 0;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (isIdentToken(arg)) {
            if (arg.value === 'at') {
                foundAt = true;
                continue;
            } else if (arg.value === 'closest-side') {
                if (radiusCount === 0) {
                    radiusX = elementWidth / 2;
                    radiusY = elementHeight / 2;
                    radiusCount = 2;
                }
                continue;
            } else if (arg.value === 'farthest-side') {
                if (radiusCount === 0) {
                    radiusX = elementWidth / 2;
                    radiusY = elementHeight / 2;
                    radiusCount = 2;
                }
                continue;
            }
        }

        if (isLengthPercentage(arg)) {
            if (!foundAt) {
                // These are the radii
                if (radiusCount === 0) {
                    radiusX = getAbsoluteValue(arg as LengthPercentage, elementWidth);
                    radiusCount++;
                } else if (radiusCount === 1) {
                    radiusY = getAbsoluteValue(arg as LengthPercentage, elementHeight);
                    radiusCount++;
                }
            } else {
                // This is center position
                if (i < args.length - 1 && isLengthPercentage(args[i + 1])) {
                    centerX = getAbsoluteValue(arg as LengthPercentage, elementWidth);
                    centerY = getAbsoluteValue(args[i + 1] as LengthPercentage, elementHeight);
                    i++; // Skip next token
                } else {
                    centerX = getAbsoluteValue(arg as LengthPercentage, elementWidth);
                }
            }
        }
    }

    // Approximate ellipse with polygon (32 segments)
    const segments = 32;
    const points: Vector[] = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const x = centerX + radiusX * Math.cos(angle);
        const y = centerY + radiusY * Math.sin(angle);
        points.push(new Vector(x, y));
    }
    return points;
};

// Parse inset() function: inset(top right bottom left round border-radius)
const inset = (args: CSSValue[], elementWidth: number, elementHeight: number): Path[] => {
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    let foundRound = false;
    let borderRadius = 0;

    const lengthValues: LengthPercentage[] = [];
    for (const arg of args) {
        if (isIdentToken(arg) && arg.value === 'round') {
            foundRound = true;
            continue;
        }
        if (isLengthPercentage(arg)) {
            if (foundRound) {
                borderRadius = getAbsoluteValue(arg, Math.min(elementWidth, elementHeight));
            } else {
                lengthValues.push(arg);
            }
        }
    }

    // Parse inset values (similar to margin/padding shorthand)
    if (lengthValues.length >= 1) {
        top = getAbsoluteValue(lengthValues[0], elementHeight);
        right = lengthValues.length >= 2 ? getAbsoluteValue(lengthValues[1], elementWidth) : top;
        bottom = lengthValues.length >= 3 ? getAbsoluteValue(lengthValues[2], elementHeight) : top;
        left = lengthValues.length >= 4 ? getAbsoluteValue(lengthValues[3], elementWidth) : right;
    }

    const x1 = left;
    const y1 = top;
    const x2 = elementWidth - right;
    const y2 = elementHeight - bottom;

    // Create rectangle path, optionally with rounded corners
    if (borderRadius > 0) {
        const kappa = 4 * ((Math.sqrt(2) - 1) / 3);
        const ox = borderRadius * kappa;
        const oy = borderRadius * kappa;
        const r = borderRadius;

        return [
            new BezierCurve(
                new Vector(x1, y1 + r),
                new Vector(x1, y1 + r - oy),
                new Vector(x1 + r - ox, y1),
                new Vector(x1 + r, y1)
            ),
            new BezierCurve(
                new Vector(x2 - r, y1),
                new Vector(x2 - r + ox, y1),
                new Vector(x2, y1 + r - oy),
                new Vector(x2, y1 + r)
            ),
            new BezierCurve(
                new Vector(x2, y2 - r),
                new Vector(x2, y2 - r + oy),
                new Vector(x2 - r + ox, y2),
                new Vector(x2 - r, y2)
            ),
            new BezierCurve(
                new Vector(x1 + r, y2),
                new Vector(x1 + r - ox, y2),
                new Vector(x1, y2 - r + oy),
                new Vector(x1, y2 - r)
            )
        ];
    } else {
        // Simple rectangle
        return [new Vector(x1, y1), new Vector(x2, y1), new Vector(x2, y2), new Vector(x1, y2)];
    }
};

const SUPPORTED_CLIP_FUNCTIONS: {
    [key: string]: (args: CSSValue[], elementWidth: number, elementHeight: number) => Path[];
} = {
    polygon: polygon,
    circle: circle,
    ellipse: ellipse,
    inset: inset
};
