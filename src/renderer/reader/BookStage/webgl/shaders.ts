/**
 * One program, four modes:
 *   0 flat page quad (static spread / page revealed under the curl, with gutter + curl shadow)
 *   1 curling page mesh (vertex shader mirrors curlMath.curlVertex exactly)
 *   2 page-stack edge strip
 *   3 soft drop shadow under a page
 * Page-local coordinates: x∈[0,1], y∈[0,aspect], y down; u_rect maps them to CSS pixels.
 */
export const MODE = { flat: 0, curl: 1, edge: 2, shadow: 3 } as const

export const VERTEX_SHADER = `#version 300 es
in vec2 a_uv;
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_aspect;
uniform int u_mode;
uniform vec2 u_origin;
uniform vec2 u_normal;
uniform float u_radius;
out vec2 v_uv;
out vec3 v_normal;
out float v_back;
out vec2 v_local;
out vec2 v_px;

const float PI = 3.14159265;

void main() {
  vec2 p = vec2(a_uv.x, a_uv.y * u_aspect);
  vec3 pos = vec3(p, 0.0);
  vec3 n = vec3(0.0, 0.0, 1.0);
  float back = 0.0;
  if (u_mode == 1) {
    float d = dot(p - u_origin, u_normal);
    if (d > 0.0) {
      vec2 proj = p - u_normal * d;
      float halfCirc = PI * u_radius;
      if (d <= halfCirc) {
        float th = d / u_radius;
        float s = sin(th);
        float c = cos(th);
        pos = vec3(proj + u_normal * u_radius * s, u_radius * (1.0 - c));
        n = vec3(-u_normal * s, c);
        back = th > PI * 0.5 ? 1.0 : 0.0;
      } else {
        pos = vec3(proj - u_normal * (d - halfCirc), 2.0 * u_radius);
        n = vec3(0.0, 0.0, -1.0);
        back = 1.0;
      }
    }
  }
  vec2 px = u_rect.xy + vec2(pos.x, pos.y / u_aspect) * u_rect.zw;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.5 - pos.z, 1.0);
  v_uv = a_uv;
  v_normal = n;
  v_back = back;
  v_local = p;
  v_px = px;
}
`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int; // must match the vertex shader's default for the shared u_mode uniform
in vec2 v_uv;
in vec3 v_normal;
in float v_back;
in vec2 v_local;
in vec2 v_px;
uniform sampler2D u_front;
uniform sampler2D u_back;
uniform int u_mode;
uniform int u_dark;
uniform vec3 u_tint;
uniform int u_curlShadow;   // flat: shade the revealed page near the fold
uniform vec2 u_origin;
uniform vec2 u_normal;
uniform float u_strength;   // curl shadow strength
uniform float u_gutter;     // flat: +1 spine at x=1 (left page), -1 spine at x=0 (right page)
uniform float u_stripes;    // edge: number of page lines
uniform vec4 u_inner;       // shadow: page rect in px (x, y, w, h)
out vec4 outColor;

vec3 tone(vec3 c) {
  c *= u_tint;
  if (u_dark == 1) {
    // Invert luminance only, keeping hue (images stay reasonably natural).
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    c = clamp(c + (1.0 - 2.0 * y), 0.0, 1.0);
  }
  return c;
}

void main() {
  if (u_mode == 3) {
    vec2 half_ = u_inner.zw * 0.5;
    vec2 q = abs(v_px - (u_inner.xy + half_)) - half_;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float a = 0.28 * (1.0 - smoothstep(0.0, 22.0, dist));
    outColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }
  if (u_mode == 2) {
    float line = 0.82 + 0.18 * step(0.5, fract(v_uv.x * u_stripes));
    outColor = vec4(tone(vec3(0.92)) * line, 1.0);
    return;
  }

  vec3 c;
  if (u_mode == 1 && v_back > 0.5) {
    vec3 b = texture(u_back, vec2(1.0 - v_uv.x, v_uv.y)).rgb;
    vec3 f = texture(u_front, v_uv).rgb;
    c = mix(b, f, 0.05); // slight paper translucency
  } else {
    c = texture(u_front, v_uv).rgb;
  }
  c = tone(c);

  if (u_mode == 1) {
    vec3 N = normalize(v_normal);
    if (v_back > 0.5) N = -N; // shade the side facing the viewer
    vec3 L = normalize(vec3(-0.35, -0.45, 1.0));
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.16;
    c = c * (0.6 + 0.4 * diff) + spec;
  } else {
    if (u_curlShadow == 1) {
      float d = dot(v_local - u_origin, u_normal);
      if (d > 0.0) c *= 1.0 - u_strength * exp(-d / 0.06);
    }
    if (u_gutter != 0.0) {
      float g = u_gutter > 0.0 ? 1.0 - v_uv.x : v_uv.x;
      c *= 1.0 - 0.22 * exp(-g / 0.03);
    }
  }
  outColor = vec4(c, 1.0);
}
`
