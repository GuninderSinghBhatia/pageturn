/**
 * One program, four modes:
 *   0 flat page quad (static spread / pages under the flip, with gutter + flip shadow)
 *   1 flipping page mesh: the leaf swings around the spine (mirrors flipMath.flipPoint exactly)
 *   2 page-stack edge strip
 *   3 soft drop shadow under a page
 * Page-local coordinates: x∈[0,1], y∈[0,aspect], y down; u_rect maps them to CSS pixels.
 */
export const MODE = { flat: 0, flip: 1, edge: 2, shadow: 3 } as const

export const VERTEX_SHADER = `#version 300 es
in vec2 a_uv;
uniform vec2 u_res;
uniform vec4 u_rect;
uniform float u_aspect;
uniform int u_mode;
uniform float u_progress; // flip: 0 = flat where it started, 1 = flat on the other side
uniform float u_bend;     // flip: extra lead of the outer edge mid-turn (radians)
uniform float u_side;     // flip: +1 = page right of the spine (spine at x=0), -1 = left (x=1)
uniform float u_eye;      // flip: viewer distance for perspective (page widths)
out vec2 v_uv;
out vec3 v_normal;
out float v_back;
out vec2 v_px;

const float PI = 3.14159265;

void main() {
  vec2 p = vec2(a_uv.x, a_uv.y * u_aspect);
  vec3 pos = vec3(p, 0.0);
  vec3 n = vec3(0.0, 0.0, 1.0);
  float back = 0.0;
  if (u_mode == 1) {
    float xs = u_side > 0.0 ? p.x : 1.0 - p.x; // distance from the spine along the paper
    float th = PI * u_progress;
    float c = u_progress >= 1.0 ? 0.0 : u_bend * sin(th);
    float ph = th + c * xs;
    float X;
    float Z;
    if (abs(c) < 1e-5) {
      X = xs * cos(th);
      Z = xs * sin(th);
    } else {
      X = (sin(ph) - sin(th)) / c;
      Z = (cos(th) - cos(ph)) / c;
    }
    float s = u_eye / (u_eye - Z); // perspective: nearer the reader = larger
    float spine = u_side > 0.0 ? 0.0 : 1.0;
    float cy = u_aspect * 0.5;
    pos = vec3(spine + u_side * X * s, cy + (p.y - cy) * s, Z);
    n = vec3(-u_side * sin(ph), 0.0, cos(ph));
    back = cos(ph) < 0.0 ? 1.0 : 0.0;
  }
  vec2 px = u_rect.xy + vec2(pos.x, pos.y / u_aspect) * u_rect.zw;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.5 - pos.z * 0.25, 1.0);
  v_uv = a_uv;
  v_normal = n;
  v_back = back;
  v_px = px;
}
`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int; // must match the vertex shader's default for the shared u_mode uniform
in vec2 v_uv;
in vec3 v_normal;
in float v_back;
in vec2 v_px;
uniform sampler2D u_front;
uniform sampler2D u_back;
uniform int u_mode;
uniform int u_dark;
uniform vec3 u_tint;
uniform float u_shadow;      // flat: flip shadow strength, darkest at the spine
uniform float u_shadowSpine; // flat: where the spine is for the flip shadow (0: x=0, 1: x=1)
uniform float u_gutter;      // flat: +1 spine at x=1 (left page), -1 spine at x=0 (right page)
uniform float u_stripes;     // edge: number of page lines
uniform vec4 u_inner;        // shadow: page rect in px (x, y, w, h)
out vec4 outColor;

vec3 tone(vec3 c) {
  c *= u_tint;
  if (u_dark == 1) {
    // Invert luminance only, keeping hue (images stay reasonably natural).
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    c = clamp(c + (1.0 - 2.0 * y), 0.0, 1.0);
    // Soften the extremes: paper becomes warm charcoal, ink an off-white.
    c = mix(vec3(0.165), vec3(0.855), c); // page #2A2A2A, text #DADADA
  }
  return c;
}

void main() {
  if (u_mode == 3) {
    vec2 half_ = u_inner.zw * 0.5;
    vec2 q = abs(v_px - (u_inner.xy + half_)) - half_;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float a = 0.25 * (1.0 - smoothstep(0.0, 40.0, dist));
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
    vec3 f = texture(u_front, vec2(v_uv.x, v_uv.y)).rgb;
    c = mix(b, f, 0.03); // slight paper translucency
  } else {
    c = texture(u_front, v_uv).rgb;
  }
  c = tone(c);

  if (u_mode == 1) {
    vec3 N = normalize(v_normal);
    if (v_back > 0.5) N = -N; // shade the side facing the reader
    vec3 L = normalize(vec3(-0.35, -0.45, 1.0));
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.12;
    c = c * (0.55 + 0.45 * diff) + spec;
  } else {
    if (u_shadow > 0.0) {
      float d = u_shadowSpine > 0.5 ? 1.0 - v_uv.x : v_uv.x;
      c *= 1.0 - u_shadow * (1.0 - smoothstep(0.0, 0.85, d));
    }
    if (u_gutter != 0.0) {
      float g = u_gutter > 0.0 ? 1.0 - v_uv.x : v_uv.x;
      c *= 1.0 - 0.08 * max(0.0, 1.0 - g / 0.055); // ~8% fading over ~24px
    }
  }
  outColor = vec4(c, 1.0);
}
`
