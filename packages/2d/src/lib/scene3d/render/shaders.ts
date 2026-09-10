// language=glsl
export const MESH_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec3 a_normal;
in vec4 a_color;

uniform mat4 u_modelViewProjection;
uniform mat4 u_model;
uniform mat3 u_normalMatrix;
uniform int u_useVertexColors;
uniform vec4 u_materialColor;

out vec4 v_color;
out vec3 v_normal;
out vec3 v_worldPosition;

void main() {
    v_normal = normalize(u_normalMatrix * a_normal);
    vec4 worldPos = u_model * vec4(a_position, 1.0);
    v_worldPosition = worldPos.xyz;

    if (u_useVertexColors != 0) {
        v_color = a_color * u_materialColor;
    } else {
        v_color = u_materialColor;
    }

    gl_Position = u_modelViewProjection * vec4(a_position, 1.0);
}
`;

// language=glsl
export const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in vec3 v_normal;
in vec3 v_worldPosition;

uniform int u_materialKind; // 0: unlit, 1: lambert
uniform float u_opacity;
uniform vec3 u_ambientLightColor;
uniform vec3 u_directionalLightDir[4];
uniform vec3 u_directionalLightColor[4];
uniform int u_numDirectionalLights;

out vec4 fragColor;

void main() {
    if (u_materialKind == 0) {
        // Unlit
        fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
    } else {
        // Lambert
        vec3 N = normalize(v_normal);
        if (!gl_FrontFacing) {
            N = -N;
        }

        vec3 lightAcc = u_ambientLightColor;
        for (int i = 0; i < 4; i++) {
            if (i >= u_numDirectionalLights) break;
            vec3 L = normalize(-u_directionalLightDir[i]);
            float nDotL = max(dot(N, L), 0.0);
            lightAcc += u_directionalLightColor[i] * nDotL;
        }

        fragColor = vec4(v_color.rgb * lightAcc, v_color.a * u_opacity);
    }
}
`;

// language=glsl
export const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec4 a_color;

uniform mat4 u_modelViewProjection;
uniform vec4 u_lineColor;
uniform int u_useVertexColors;

out vec4 v_color;

void main() {
    if (u_useVertexColors != 0) {
        v_color = a_color * u_lineColor;
    } else {
        v_color = u_lineColor;
    }
    gl_Position = u_modelViewProjection * vec4(a_position, 1.0);
}
`;

// language=glsl
export const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
uniform float u_opacity;

out vec4 fragColor;

void main() {
    fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`;

// language=glsl
export const POINT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 a_position;
in vec4 a_color;
in float a_size;

uniform mat4 u_modelViewProjection;
uniform vec4 u_pointColor;
uniform float u_defaultPointSize;
uniform int u_useVertexColors;
uniform int u_useVertexSizes;

out vec4 v_color;

void main() {
    if (u_useVertexColors != 0) {
        v_color = a_color * u_pointColor;
    } else {
        v_color = u_pointColor;
    }

    if (u_useVertexSizes != 0) {
        gl_PointSize = a_size;
    } else {
        gl_PointSize = u_defaultPointSize;
    }

    gl_Position = u_modelViewProjection * vec4(a_position, 1.0);
}
`;

// language=glsl
export const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
uniform float u_opacity;

out vec4 fragColor;

void main() {
    // Render round points
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (dot(coord, coord) > 0.25) {
        discard;
    }
    fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`;
