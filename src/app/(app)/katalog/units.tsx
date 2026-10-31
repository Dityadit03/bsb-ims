// Ilustrasi unit (tampak samping) per jenis, dibagi menjadi rakitan yang bisa bergeser saat "dibongkar".
// Koordinat: viewBox 900x450, tanah di y=320, depan unit di kiri.
import type { ReactNode } from 'react';

export const VW = 900, VH = 450;
export type Template = 'pickup' | 'service' | 'dump';
export type Asm = { id: string; dx: number; dy: number; node: ReactNode };
export type Marker = { asm: string; x: number; y: number };
export type UnitArt = { asms: Asm[]; markers: Record<string, Marker>; defs: ReactNode };

const PALETTE: Record<string, { body: string; shade: string; accent: string }> = {
  HILUX: { body: '#f4f5f7', shade: '#bfc5cf', accent: '#c1121f' },
  TRITON: { body: '#7d8fa3', shade: '#46586b', accent: '#f08c00' },
  'HINO-SVC': { body: '#f4f5f7', shade: '#b8bec8', accent: '#f2b705' },
  'HINO-DT12': { body: '#f59f00', shade: '#b36b00', accent: '#1f2328' },
  'SHACMAN-F3000': { body: '#d9381e', shade: '#8f1d0b', accent: '#f4f5f7' },
};
const DEFAULT = { body: '#e5e7eb', shade: '#9ca3af', accent: '#7A1FD0' };

function Wheel({ cx, cy, r, dual = false }: { cx: number; cy: number; r: number; dual?: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 7} fill="#0e1114" opacity=".55" />
      {dual && <circle cx={cx - 6} cy={cy} r={r} fill="#14181c" />}
      <circle cx={cx} cy={cy} r={r} fill="url(#tire)" />
      <circle cx={cx} cy={cy} r={r * 0.97} fill="none" stroke="#2c333a" strokeWidth="3" strokeDasharray="6 5" />
      <circle cx={cx} cy={cy} r={r * 0.62} fill="url(#rim)" />
      <g className="origin-center animate-spin motion-reduce:animate-none" style={{ transformBox: 'fill-box', animationDuration: '9s' }}>
        <circle cx={cx} cy={cy} r={r * 0.42} fill="none" stroke="#6b7480" strokeWidth="2" />
        {[0, 60, 120, 180, 240, 300].map(a => (
          <circle key={a} cx={cx + Math.cos((a * Math.PI) / 180) * r * 0.42} cy={cy + Math.sin((a * Math.PI) / 180) * r * 0.42} r={r * 0.06} fill="#3a424b" />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r * 0.2} fill="#d5dae1" stroke="#8b94a0" strokeWidth="2" />
    </g>
  );
}

function Defs({ body, shade }: { body: string; shade: string }) {
  return (
    <defs>
      <linearGradient id="gbody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={body} /><stop offset="1" stopColor={shade} /></linearGradient>
      <linearGradient id="gglass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bfe3f5" /><stop offset=".55" stopColor="#5f8fb0" /><stop offset="1" stopColor="#2f4a63" /></linearGradient>
      <linearGradient id="gmetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d9dee5" /><stop offset="1" stopColor="#7c8794" /></linearGradient>
      <linearGradient id="gdark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a5360" /><stop offset="1" stopColor="#262c33" /></linearGradient>
      <radialGradient id="tire"><stop offset=".55" stopColor="#2a3037" /><stop offset="1" stopColor="#0f1215" /></radialGradient>
      <radialGradient id="rim"><stop offset="0" stopColor="#eef1f5" /><stop offset="1" stopColor="#8b94a0" /></radialGradient>
    </defs>
  );
}

const Lights = ({ x, y, h = 14 }: { x: number; y: number; h?: number }) => (
  <g><rect x={x} y={y} width="14" height={h} rx="4" fill="#fff6c9" stroke="#caa400" strokeWidth="1.5" /><rect x={x - 6} y={y + h + 4} width="26" height="8" rx="3" fill="url(#gdark)" /></g>
);

function pickup(c: typeof DEFAULT): UnitArt {
  const markers: Record<string, Marker> = {
    CLG: { asm: 'hood', x: 135, y: 243 }, ELC: { asm: 'hood', x: 188, y: 226 }, ENG: { asm: 'hood', x: 240, y: 244 },
    CAB: { asm: 'cab', x: 392, y: 176 }, STR: { asm: 'cab', x: 322, y: 226 },
    TRM: { asm: 'frame', x: 290, y: 269 }, PRP: { asm: 'frame', x: 440, y: 269 }, FUE: { asm: 'frame', x: 375, y: 300 }, EXH: { asm: 'frame', x: 548, y: 300 },
    FAX: { asm: 'fw', x: 190, y: 284 }, BRK: { asm: 'fw', x: 224, y: 254 }, RAX: { asm: 'rw', x: 640, y: 284 }, WHL: { asm: 'rw', x: 674, y: 254 },
  };
  return {
    defs: <Defs body={c.body} shade={c.shade} />, markers,
    asms: [
      { id: 'frame', dx: 0, dy: 26, node: (
        <g>
          <rect x="120" y="262" width="665" height="14" rx="4" fill="url(#gdark)" />
          <rect x="330" y="278" width="90" height="26" rx="9" fill="url(#gmetal)" stroke="#6b7480" />
          <path d="M250 292 H520" stroke="#8b94a0" strokeWidth="7" strokeLinecap="round" fill="none" />
          <rect x="515" y="282" width="80" height="24" rx="10" fill="url(#gmetal)" stroke="#6b7480" />
          <path d="M595 294 H700" stroke="#8b94a0" strokeWidth="6" strokeLinecap="round" fill="none" />
          <line x1="190" y1="284" x2="640" y2="284" stroke="#59626e" strokeWidth="6" />
          <ellipse cx="190" cy="288" rx="22" ry="12" fill="url(#gdark)" /><ellipse cx="640" cy="288" rx="24" ry="13" fill="url(#gdark)" />
        </g>) },
      { id: 'hood', dx: -52, dy: -16, node: (
        <g>
          <path d="M100 262 V236 Q100 224 114 221 L286 204 V262 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          <path d="M110 250 H282" stroke={c.shade} strokeWidth="1.5" opacity=".7" />
          <rect x="97" y="244" width="22" height="20" rx="4" fill="url(#gdark)" /><rect x="104" y="228" width="16" height="12" rx="4" fill="#fff6c9" stroke="#caa400" />
          <rect x="88" y="250" width="34" height="14" rx="5" fill="url(#gdark)" />
        </g>) },
      { id: 'cab', dx: 0, dy: -58, node: (
        <g>
          <path d="M286 204 L332 130 Q337 122 350 122 H432 Q446 122 452 133 L474 204 V262 H286 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          <path d="M300 202 L338 138 H428 L458 202 Z" fill="url(#gglass)" stroke="#2f4a63" strokeWidth="2" />
          <path d="M384 138 V202" stroke={c.shade} strokeWidth="3" />
          <rect x="298" y="216" width="170" height="3" fill={c.shade} opacity=".6" />
          <rect x="426" y="226" width="20" height="5" rx="2" fill={c.shade} />
          <path d="M292 190 l-16 3 v10 l16 -2z" fill="url(#gdark)" />
        </g>) },
      { id: 'body', dx: 62, dy: -40, node: (
        <g>
          <path d="M474 262 V214 H792 V262 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          <rect x="474" y="208" width="318" height="8" rx="3" fill="url(#gdark)" />
          <path d="M486 232 H780" stroke={c.shade} strokeWidth="1.5" opacity=".6" />
          <rect x="784" y="220" width="8" height="16" rx="3" fill="#e03131" />
        </g>) },
      { id: 'fw', dx: -26, dy: 58, node: <Wheel cx={190} cy={284} r={36} /> },
      { id: 'rw', dx: 26, dy: 58, node: <Wheel cx={640} cy={284} r={36} /> },
    ],
  };
}

function service(c: typeof DEFAULT): UnitArt {
  const markers: Record<string, Marker> = {
    STR: { asm: 'cab', x: 132, y: 232 }, CAB: { asm: 'cab', x: 190, y: 176 }, ELC: { asm: 'cab', x: 246, y: 232 },
    ENG: { asm: 'eng', x: 266, y: 292 }, CLG: { asm: 'eng', x: 312, y: 292 },
    CLT: { asm: 'frame', x: 345, y: 266 }, TRM: { asm: 'frame', x: 398, y: 266 }, PRP: { asm: 'frame', x: 455, y: 266 }, FUE: { asm: 'frame', x: 384, y: 304 }, EXH: { asm: 'frame', x: 296, y: 206 },
    FAX: { asm: 'fw', x: 185, y: 276 }, BRK: { asm: 'fw', x: 224, y: 246 }, RAX: { asm: 'rw', x: 645, y: 276 }, WHL: { asm: 'rw', x: 645, y: 236 },
    HYD: { asm: 'body', x: 640, y: 96 }, CMP: { asm: 'body', x: 520, y: 296 },
  };
  return {
    defs: <Defs body={c.body} shade={c.shade} />, markers,
    asms: [
      { id: 'frame', dx: 0, dy: 20, node: (
        <g>
          <rect x="110" y="262" width="700" height="16" rx="4" fill="url(#gdark)" />
          <rect x="330" y="282" width="92" height="30" rx="10" fill="url(#gmetal)" stroke="#6b7480" />
          <rect x="291" y="96" width="9" height="168" rx="3" fill="url(#gmetal)" /><rect x="288" y="90" width="15" height="10" rx="3" fill="#59626e" />
          <path d="M430 294 H600" stroke="#8b94a0" strokeWidth="7" strokeLinecap="round" />
          <line x1="185" y1="276" x2="690" y2="276" stroke="#59626e" strokeWidth="6" />
        </g>) },
      { id: 'eng', dx: 10, dy: 40, node: (
        <g>
          <rect x="238" y="268" width="96" height="40" rx="8" fill="url(#gmetal)" stroke="#6b7480" strokeWidth="1.5" />
          {[250, 262, 274, 286, 298, 310, 322].map(x => <line key={x} x1={x} y1="274" x2={x} y2="302" stroke="#59626e" strokeWidth="2" />)}
        </g>) },
      { id: 'cab', dx: -14, dy: -60, node: (
        <g>
          <path d="M100 262 V146 Q100 128 120 128 H262 Q272 128 276 138 L290 262 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          <path d="M114 150 H258 L266 210 H114 Z" fill="url(#gglass)" stroke="#2f4a63" strokeWidth="2" />
          <path d="M112 226 H282" stroke={c.shade} strokeWidth="1.5" />
          <rect x="104" y="232" width="18" height="16" rx="4" fill="#fff6c9" stroke="#caa400" /><rect x="96" y="250" width="40" height="12" rx="4" fill="url(#gdark)" />
          <rect x="130" y="238" width="60" height="14" rx="3" fill="url(#gdark)" opacity=".7" />
          <rect x="100" y="212" width="190" height="6" fill={c.accent} opacity=".9" />
        </g>) },
      { id: 'body', dx: 56, dy: -40, node: (
        <g>
          <path d="M300 262 V138 H800 V262 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          {[420, 540, 660].map(x => <line key={x} x1={x} y1="146" x2={x} y2="256" stroke={c.shade} strokeWidth="2" />)}
          {[330, 450, 570, 690].map(x => <rect key={x} x={x} y="214" width="78" height="30" rx="4" fill="none" stroke={c.shade} strokeWidth="1.5" />)}
          <rect x="300" y="190" width="500" height="9" fill={c.accent} />
          <rect x="470" y="276" width="104" height="24" rx="12" fill="url(#gmetal)" stroke="#6b7480" />
          <path d="M540 138 L548 96 L706 54 L718 70 L586 138 Z" fill="url(#gdark)" stroke="#262c33" />
          <path d="M600 138 L690 76" stroke="#d5dae1" strokeWidth="9" strokeLinecap="round" />
          <path d="M712 62 V112" stroke="#59626e" strokeWidth="3" /><path d="M706 112 h12 v10 h-12z" fill="#59626e" />
        </g>) },
      { id: 'fw', dx: -28, dy: 56, node: <Wheel cx={185} cy={276} r={44} /> },
      { id: 'rw', dx: 28, dy: 56, node: <g><Wheel cx={600} cy={276} r={44} dual /><Wheel cx={690} cy={276} r={44} dual /></g> },
    ],
  };
}

function dump(c: typeof DEFAULT): UnitArt {
  const markers: Record<string, Marker> = {
    STR: { asm: 'cab', x: 126, y: 232 }, CAB: { asm: 'cab', x: 190, y: 160 }, ELC: { asm: 'cab', x: 250, y: 232 },
    ENG: { asm: 'eng', x: 348, y: 292 }, CLG: { asm: 'eng', x: 394, y: 292 },
    CLT: { asm: 'frame', x: 332, y: 262 }, TRM: { asm: 'frame', x: 388, y: 262 }, PRP: { asm: 'frame', x: 450, y: 262 }, FUE: { asm: 'frame', x: 496, y: 300 }, EXH: { asm: 'frame', x: 580, y: 262 },
    FAX: { asm: 'fw', x: 218, y: 276 }, BRK: { asm: 'fw', x: 262, y: 238 }, RAX: { asm: 'rw', x: 664, y: 276 }, WHL: { asm: 'rw', x: 664, y: 236 },
    DMP: { asm: 'body', x: 540, y: 198 },
  };
  return {
    defs: <Defs body={c.body} shade={c.shade} />, markers,
    asms: [
      { id: 'frame', dx: 0, dy: 18, node: (
        <g>
          <rect x="110" y="252" width="700" height="18" rx="4" fill="url(#gdark)" />
          <rect x="440" y="274" width="112" height="34" rx="11" fill="url(#gmetal)" stroke="#6b7480" />
          <path d="M424 290 H620" stroke="#8b94a0" strokeWidth="7" strokeLinecap="round" />
          <line x1="175" y1="276" x2="708" y2="276" stroke="#59626e" strokeWidth="6" />
          <rect x="296" y="110" width="9" height="150" rx="3" fill="url(#gmetal)" />
        </g>) },
      { id: 'eng', dx: 0, dy: 44, node: (
        <g>
          <rect x="318" y="272" width="104" height="38" rx="8" fill="url(#gmetal)" stroke="#6b7480" strokeWidth="1.5" />
          {[330, 342, 354, 366, 378, 390, 402, 414].map(x => <line key={x} x1={x} y1="278" x2={x} y2="304" stroke="#59626e" strokeWidth="2" />)}
        </g>) },
      { id: 'cab', dx: -16, dy: -62, node: (
        <g>
          <path d="M96 262 V128 Q96 104 122 104 H262 Q276 104 282 118 L294 262 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          <path d="M110 130 H262 L270 200 H110 Z" fill="url(#gglass)" stroke="#2f4a63" strokeWidth="2" />
          <rect x="92" y="96" width="196" height="12" rx="5" fill={c.shade} />
          <rect x="102" y="214" width="60" height="22" rx="3" fill="url(#gdark)" />
          {[108, 118, 128, 138, 148, 158].map(x => <line key={x} x1={x} y1="218" x2={x} y2="232" stroke="#8b94a0" strokeWidth="2" />)}
          <rect x="100" y="238" width="20" height="16" rx="4" fill="#fff6c9" stroke="#caa400" /><rect x="90" y="250" width="50" height="12" rx="4" fill="url(#gdark)" />
          <rect x="96" y="204" width="198" height="6" fill={c.accent} opacity=".9" />
        </g>) },
      { id: 'body', dx: 70, dy: -58, node: (
        <g>
          <path d="M304 252 V146 H770 Q782 146 784 158 L794 252 Z" fill="url(#gbody)" stroke={c.shade} strokeWidth="1.5" />
          {[360, 420, 480, 540, 600, 660, 720].map(x => <line key={x} x1={x} y1="150" x2={x} y2="246" stroke={c.shade} strokeWidth="2.5" opacity=".75" />)}
          <rect x="300" y="138" width="486" height="12" rx="4" fill="url(#gdark)" />
          <rect x="304" y="226" width="490" height="10" fill={c.accent} opacity=".85" />
          <path d="M372 252 L420 178" stroke="#59626e" strokeWidth="14" strokeLinecap="round" /><path d="M372 252 L420 178" stroke="#d5dae1" strokeWidth="6" strokeLinecap="round" />
        </g>) },
      { id: 'fw', dx: -28, dy: 56, node: <g><Wheel cx={175} cy={276} r={44} /><Wheel cx={262} cy={276} r={44} /></g> },
      { id: 'rw', dx: 28, dy: 56, node: <g><Wheel cx={620} cy={276} r={44} dual /><Wheel cx={708} cy={276} r={44} dual /></g> },
    ],
  };
}

export function buildUnit(code: string, template: Template): UnitArt {
  const c = PALETTE[code] ?? DEFAULT;
  return template === 'pickup' ? pickup(c) : template === 'service' ? service(c) : dump(c);
}
