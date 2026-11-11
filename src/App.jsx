import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";

// En el navegador y en la app empaquetada, el almacenamiento es el del sistema.
const store = {
  get: async (k) => { const v = localStorage.getItem(k); return v == null ? null : { value: v }; },
  set: async (k, v) => { localStorage.setItem(k, v); return { value: v }; },
  delete: async (k) => { localStorage.removeItem(k); return { deleted: true }; },
};


/* ---------- paleta ---------- */
const C = {
  bg: "#111A20",        // la mesa
  panel: "#243139",     // botones y campos
  surface: "#1B252C",   // bloques agrupados
  line: "#33444E",
  ink: "#E7EEF2",
  soft: "#93A7B3",      // texto secundario
  accent: "#6F76F2",
  accentInk: "#FFFFFF", // texto sobre el acento
  ferrari: "#FF2800",
  warn: "#FF8A70",
};

const KEY = "trama:actual";
const KEY_VIEJA = "murdoku:actual";
// Ámbitos de unicidad: de ellos se deriva el tachado, la retirada de
// candidatos y la validación. "ocupa" = una sola casilla ocupada en el ámbito.
const REGLAS = {
  murdoku: {
    ocupacionUnica: true,   // casillas ocupadas por fila y por columna
    porLinea: 1, adyacencia: false,
    simboloFila: false, simboloCol: false, simboloCaja: false,
    simboloTablero: true,   // cada símbolo aparece una sola vez en todo el tablero
    cajaR: 3, cajaC: 3,
    ultimaLibre: true, tachado: true, errores: true, alcance: false,
    regiones: true, ocupaRegion: false, anuncio: true,
  },
  sudoku: {
    ocupacionUnica: false, porLinea: 1, adyacencia: false,
    simboloFila: true, simboloCol: true, simboloCaja: true,
    simboloTablero: false,
    cajaR: 3, cajaC: 3,
    ultimaLibre: false, tachado: false, errores: true, alcance: true,
    regiones: true, ocupaRegion: false, anuncio: true,
  },
};

const REGLAS_STAR_TMP = {
  ocupacionUnica: true, porLinea: 1, adyacencia: true,
  simboloFila: false, simboloCol: false, simboloCaja: false, simboloTablero: false,
  cajaR: 3, cajaC: 3,
  ultimaLibre: false, tachado: true, errores: true, alcance: false,
  regiones: true, ocupaRegion: true, anuncio: true,
};
REGLAS.star = REGLAS_STAR_TMP;

const PRESETS = {
  murdoku: { nombre: "Murdoku", rows: 6, cols: 6, palette: ["A", "B", "C", "D", "E", "V"] },
  sudoku: { nombre: "Sudoku", rows: 9, cols: 9, palette: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
  star: { nombre: "Star Battle", rows: 9, cols: 9, palette: ["\u2605"] },
  libre: { nombre: "Personalizado" },
};

// Colores disponibles para las paredes. Los mapas de Murdoku a veces distinguen
// tipos de zona por color, y perderlo al dibujar encima estorba para resolver.
const COLORES = [
  { id: "n", nombre: "Negro", css: "#15191C", claro: false },
  { id: "b", nombre: "Blanco", css: "#FFFFFF", claro: true },
  { id: "a", nombre: "Amarillo", css: "#F2C531", claro: true },
  { id: "o", nombre: "Naranja", css: "#EE7A22", claro: true },
  { id: "s", nombre: "Rosa", css: "#F06FA8", claro: true },
  { id: "r", nombre: "Rojo", css: "#E0322A", claro: false },
  { id: "v", nombre: "Verde", css: "#3EA75C", claro: false },
  { id: "c", nombre: "Celeste", css: "#5CC4E8", claro: true },
  { id: "z", nombre: "Azul", css: "#2F5FD0", claro: false },
  { id: "m", nombre: "Violeta", css: "#8A5CE0", claro: false },
];
const colorPared = (id) => (COLORES.find((c) => c.id === id) || COLORES[0]);

const FICHA = 50;   // lado de las fichas de personaje
const HUECO = 6;    // separación entre fichas
const MAX_IMPORT = 1600;

/* ---------- álgebra: homografía ---------- */
function gauss(A0, b0) {
  const n = b0.length;
  const A = A0.map((r, i) => [...r, b0[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    const t = A[i]; A[i] = A[p]; A[p] = t;
    const piv = A[i][i];
    if (Math.abs(piv) < 1e-12) return null;
    for (let c = i; c <= n; c++) A[i][c] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i];
      if (!f) continue;
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((r) => r[n]);
}

// mapea el cuadrado unidad (destino) al cuadrilátero de la foto (origen)
function coeffs(src) {
  const u = [0, 1, 1, 0], v = [0, 0, 1, 1];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    A.push([u[i], v[i], 1, 0, 0, 0, -u[i] * src[i].x, -v[i] * src[i].x]); b.push(src[i].x);
    A.push([0, 0, 0, u[i], v[i], 1, -u[i] * src[i].y, -v[i] * src[i].y]); b.push(src[i].y);
  }
  return gauss(A, b);
}

function warp(imgEl, corners, outW, outH) {
  const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
  const sc = document.createElement("canvas");
  sc.width = nw; sc.height = nh;
  const sctx = sc.getContext("2d");
  sctx.drawImage(imgEl, 0, 0);
  const S = sctx.getImageData(0, 0, nw, nh).data;

  const k = coeffs(corners.map((p) => ({ x: p.x * nw, y: p.y * nh })));
  if (!k) return null;
  const [a, b, c, d, e, f, g, h] = k;

  const dc = document.createElement("canvas");
  dc.width = outW; dc.height = outH;
  const dctx = dc.getContext("2d");
  const out = dctx.createImageData(outW, outH);
  const D = out.data;

  for (let py = 0; py < outH; py++) {
    const v = (py + 0.5) / outH;
    for (let px = 0; px < outW; px++) {
      const u = (px + 0.5) / outW;
      const den = g * u + h * v + 1;
      const x = (a * u + b * v + c) / den;
      const y = (d * u + e * v + f) / den;
      const o = (py * outW + px) * 4;
      if (x < 0 || y < 0 || x > nw - 1 || y > nh - 1) {
        D[o] = D[o + 1] = D[o + 2] = 235; D[o + 3] = 255;
        continue;
      }
      const x0 = x | 0, y0 = y | 0;
      const x1 = Math.min(x0 + 1, nw - 1), y1 = Math.min(y0 + 1, nh - 1);
      const fx = x - x0, fy = y - y0;
      const i00 = (y0 * nw + x0) * 4, i10 = (y0 * nw + x1) * 4;
      const i01 = (y1 * nw + x0) * 4, i11 = (y1 * nw + x1) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = S[i00 + ch] * (1 - fx) + S[i10 + ch] * fx;
        const bot = S[i01 + ch] * (1 - fx) + S[i11 + ch] * fx;
        D[o + ch] = top * (1 - fy) + bot * fy;
      }
      D[o + 3] = 255;
    }
  }
  dctx.putImageData(out, 0, 0);
  return dc.toDataURL("image/jpeg", 0.85);
}

/* ---------- utilidades ---------- */
function shrink(dataUrl, max) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      if (s === 1) return res(dataUrl);
      const cv = document.createElement("canvas");
      cv.width = Math.round(im.naturalWidth * s);
      cv.height = Math.round(im.naturalHeight * s);
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", 0.85));
    };
    im.onerror = () => res(dataUrl);
    im.src = dataUrl;
  });
}

// V queda reservada para la víctima, así que no entra en el reparto automático
const ABC = "ABCDEFGHIJKLMNOPQRSTUWXYZ";

// Admite "1 2 3", "1,2,3", "1-2-3" o "123" sin separar. Solo cuando hay algún
// separador se aceptan símbolos de dos caracteres.
const parsePalette = (txt) => {
  const t = txt.toUpperCase();
  const haySep = /[^0-9A-ZÁÉÍÓÚÜÑ]/.test(t);
  const bruto = haySep
    ? t.split(/[^0-9A-ZÁÉÍÓÚÜÑ]+/).filter(Boolean).map((x) => x.slice(0, 2))
    : t.split("");
  return bruto.slice(0, 24);
};

const addChar = (p) => {
  const hasV = p.length > 0 && p[p.length - 1] === "V";
  const body = hasV ? p.slice(0, -1) : p;
  const next = ABC.split("").find((L) => p.indexOf(L) < 0) || "?";
  return hasV ? [...body, next, "V"] : [...body, next];
};

const removeChar = (p) => {
  if (p.length <= 1) return p;
  return p[p.length - 1] === "V" ? [...p.slice(0, -2), "V"] : p.slice(0, -1);
};

// ordena los candidatos siguiendo el orden de la lista de personajes
const sortCand = (arr, palette) => {
  const k = (L) => {
    const i = palette.indexOf(L);
    return i < 0 ? 999 : i;
  };
  return [...arr].sort((a, b) => k(a) - k(b) || a.localeCompare(b));
};

/* ---------- iconos ---------- */
function IconUndo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </svg>
  );
}

function IconMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M6 3h12v18l-6-4.5L6 21z" />
    </svg>
  );
}

function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M4 5v6h6" />
      <path d="M4 11a8 8 0 1 1 2.3 5.7" />
    </svg>
  );
}

function IconFull({ on }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      {on
        ? <><path d="M9 3v6H3" /><path d="M15 3v6h6" /><path d="M9 21v-6H3" /><path d="M15 21v-6h6" /></>
        : <><path d="M3 9V3h6" /><path d="M21 9V3h-6" /><path d="M3 15v6h6" /><path d="M21 15v6h-6" /></>}
    </svg>
  );
}

/* ---------- botón ---------- */
function Btn({ children, onClick, active, disabled, tone, style }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        border: "1px solid " + (active ? C.accent : C.line),
        background: active ? C.accent : C.panel,
        color: active ? C.accentInk : tone === "warn" ? C.warn : C.ink,
        borderRadius: 11,
        padding: "10px 12px",
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        lineHeight: 1.1,
        opacity: disabled ? 0.4 : 1,
        touchAction: "manipulation",
        cursor: disabled ? "default" : "pointer",
        ...style,
      }}
    >{children}</button>
  );
}

/* ---------- pantalla: ajustes ---------- */
function resumenReglas(r) {
  const partes = [];
  if (r.ocupacionUnica) {
    const n = Math.max(1, r.porLinea || 1);
    partes.push((n === 1 ? "una sola casilla ocupada" : n + " casillas ocupadas") +
      " por fila y por columna" + (r.ocupaRegion ? " y por región" : ""));
  }
  if (r.adyacencia) partes.push("las ocupadas no pueden tocarse");
  if (r.regiones) partes.push("con regiones dibujadas");
  if (r.simboloTablero) partes.push("cada símbolo una sola vez en todo el tablero");
  const ambitos = [];
  if (r.simboloFila) ambitos.push("fila");
  if (r.simboloCol) ambitos.push("columna");
  if (r.simboloCaja) ambitos.push(r.regiones ? "región" : "caja de " + r.cajaR + "×" + r.cajaC);
  if (ambitos.length) partes.push("cada símbolo una sola vez por " + ambitos.join(", "));
  if (!partes.length) return "Sin comprobaciones automáticas: el cuaderno no vigila ninguna regla.";
  const t = partes.join("; ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

function Switch({ on, onChange, children }) {
  return (
    <button onClick={() => onChange(!on)}
      style={{
        display: "flex", alignItems: "center", gap: 12, width: "100%",
        padding: "11px 13px", marginBottom: 7, textAlign: "left",
        background: C.surface, border: "1px solid " + C.line, borderRadius: 11,
        color: C.ink, fontSize: 15, cursor: "pointer", touchAction: "manipulation",
      }}>
      <span style={{
        width: 42, height: 25, borderRadius: 13, flex: "0 0 auto", position: "relative",
        background: on ? C.accent : C.panel, border: "1px solid " + (on ? C.accent : C.line),
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 19 : 2,
          width: 19, height: 19, borderRadius: "50%", background: on ? "#fff" : C.soft,
        }} />
      </span>
      <span>{children}</span>
    </button>
  );
}

function Setup({
  rows, cols, palette, reglas, preset, onChange, onPreset,
  onPhoto, onStart, onBoard, onSaves, onHelp, onLeer, onGuardarImagen,
  onDetectarRegiones, onSinFoto, avisoReg, hasImg, hayMapa,
}) {
  const fileRef = useRef(null);
  const galRef = useRef(null);
  const [txt, setTxt] = useState(palette.join(" "));
  const [avanzado, setAvanzado] = useState(false);

  useEffect(() => {
    if (parsePalette(txt).join(" ") !== palette.join(" ")) setTxt(palette.join(" "));
  }, [palette]); // eslint-disable-line react-hooks/exhaustive-deps

  const R = (k, v) => onChange({ reglas: { ...reglas, [k]: v } });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: 20, paddingBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "0.04em", color: "#E8B54A" }}>TRAMA</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={onHelp}>Ayuda</Btn>
          <Btn onClick={onSaves}>Partidas</Btn>
        </div>
      </div>
      <p style={{ color: C.soft, margin: "2px 0 24px", fontSize: 15 }}>
        Cuaderno para resolver pasatiempos de cuadrículas sobre una fotografía.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, color: C.soft }}>Filas:</span>
        <Btn onClick={() => onChange({ rows: Math.max(3, rows - 1) })}>−</Btn>
        <span style={{ fontSize: 20, minWidth: 28, textAlign: "center" }}>{rows}</span>
        <Btn onClick={() => onChange({ rows: Math.min(16, rows + 1) })}>+</Btn>
        <span style={{ width: 18 }} />
        <span style={{ fontSize: 15, color: C.soft }}>Columnas:</span>
        <Btn onClick={() => onChange({ cols: Math.max(3, cols - 1) })}>−</Btn>
        <span style={{ fontSize: 20, minWidth: 28, textAlign: "center" }}>{cols}</span>
        <Btn onClick={() => onChange({ cols: Math.min(16, cols + 1) })}>+</Btn>
      </div>

      {reglas.ocupacionUnica && (preset === "star" || (reglas.porLinea || 1) > 1) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, color: C.soft }}>
            {preset === "star" ? "Estrellas:" : "Ocupadas por línea:"}
          </span>
          <Btn onClick={() => onChange({ reglas: { ...reglas, porLinea: Math.max(1, (reglas.porLinea || 1) - 1) } })}>−</Btn>
          <span style={{ fontSize: 20, minWidth: 28, textAlign: "center" }}>{reglas.porLinea || 1}</span>
          <Btn onClick={() => onChange({ reglas: { ...reglas, porLinea: Math.min(4, (reglas.porLinea || 1) + 1) } })}>+</Btn>
          <span style={{ fontSize: 14, color: C.soft }}>
            por fila, columna{reglas.ocupaRegion ? " y región" : ""}
          </span>
        </div>
      )}

      <label style={{ display: "block", fontSize: 15, color: C.soft, marginBottom: 9 }}>
        Símbolos que se van a colocar
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Btn onClick={() => onChange({ palette: removeChar(palette) })} disabled={palette.length <= 1}>−</Btn>
        <span style={{ fontSize: 20, minWidth: 28, textAlign: "center" }}>{palette.length}</span>
        <Btn onClick={() => onChange({ palette: addChar(palette) })} disabled={palette.length >= 24}>+</Btn>
      </div>
      <input
        value={txt}
        onChange={(ev) => { setTxt(ev.target.value); onChange({ palette: parsePalette(ev.target.value) }); }}
        style={{
          width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 18,
          letterSpacing: 3, border: "1px solid " + C.line, borderRadius: 11,
          background: C.surface, color: C.ink, marginBottom: 22, outlineColor: C.accent,
        }}
      />

      <label style={{ display: "block", fontSize: 15, color: C.soft, marginBottom: 9 }}>Pasatiempo</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        {["murdoku", "sudoku", "star", "libre"].map((k) => (
          <Btn key={k} active={preset === k}
            onClick={() => { onPreset(k); setAvanzado(k === "libre"); }}>
            {PRESETS[k].nombre}
          </Btn>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <label style={{ fontSize: 15, color: C.soft }}>Reglas del tablero</label>
        <Btn onClick={() => setAvanzado(!avanzado)} style={{ padding: "7px 12px", fontSize: 14 }}>
          {avanzado ? "Ocultar" : "Ver y cambiar"}
        </Btn>
      </div>

      {!avanzado && (
        <p style={{ fontSize: 14, color: C.soft, margin: "0 0 22px", lineHeight: 1.5 }}>
          {resumenReglas(reglas)}
        </p>
      )}

      {avanzado && (
        <div style={{ marginBottom: 22 }}>
          <Switch on={reglas.ocupacionUnica} onChange={(v) => R("ocupacionUnica", v)}>
            Número fijo de casillas ocupadas por fila y por columna, tachando el resto
          </Switch>
          {reglas.ocupacionUnica && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: C.soft, marginLeft: 4 }}>
                Por fila, columna{reglas.ocupaRegion ? " y región" : ""}:
              </span>
              <Btn onClick={() => R("porLinea", Math.max(1, (reglas.porLinea || 1) - 1))}>−</Btn>
              <span style={{ fontSize: 18, minWidth: 20, textAlign: "center" }}>{reglas.porLinea || 1}</span>
              <Btn onClick={() => R("porLinea", Math.min(4, (reglas.porLinea || 1) + 1))}>+</Btn>
            </div>
          )}
          <Switch on={reglas.ocupaRegion} onChange={(v) => R("ocupaRegion", v)}>
            Ese mismo número se aplica también a cada región
          </Switch>
          <Switch on={reglas.adyacencia} onChange={(v) => R("adyacencia", v)}>
            Las casillas ocupadas no pueden tocarse, ni siquiera en diagonal
          </Switch>
          <Switch on={reglas.simboloTablero} onChange={(v) => R("simboloTablero", v)}>
            Cada símbolo aparece una sola vez en todo el tablero
          </Switch>
          <Switch on={reglas.simboloFila} onChange={(v) => R("simboloFila", v)}>
            Cada símbolo, una sola vez por fila
          </Switch>
          <Switch on={reglas.simboloCol} onChange={(v) => R("simboloCol", v)}>
            Cada símbolo, una sola vez por columna
          </Switch>
          <Switch on={reglas.regiones} onChange={(v) => R("regiones", v)}>
            El tablero tiene regiones dibujadas, en lugar de cajas rectangulares
          </Switch>
          <Switch on={reglas.simboloCaja} onChange={(v) => R("simboloCaja", v)}>
            Cada símbolo, una sola vez por {reglas.regiones ? "región" : "caja"}
          </Switch>
          {reglas.simboloCaja && !reglas.regiones && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: C.soft, marginLeft: 4 }}>Caja de</span>
              <Btn onClick={() => R("cajaR", Math.max(1, reglas.cajaR - 1))}>−</Btn>
              <span style={{ fontSize: 18, minWidth: 20, textAlign: "center" }}>{reglas.cajaR}</span>
              <Btn onClick={() => R("cajaR", Math.min(rows, reglas.cajaR + 1))}>+</Btn>
              <span style={{ color: C.soft }}>×</span>
              <Btn onClick={() => R("cajaC", Math.max(1, reglas.cajaC - 1))}>−</Btn>
              <span style={{ fontSize: 18, minWidth: 20, textAlign: "center" }}>{reglas.cajaC}</span>
              <Btn onClick={() => R("cajaC", Math.min(cols, reglas.cajaC + 1))}>+</Btn>
            </div>
          )}
          <Switch on={reglas.ultimaLibre} onChange={(v) => R("ultimaLibre", v)}>
            Resaltar en verde la última casilla libre
          </Switch>
          <Switch on={reglas.tachado} onChange={(v) => R("tachado", v)}>
            Permitir anular casillas con una X durante la partida
          </Switch>
          <Switch on={reglas.errores} onChange={(v) => R("errores", v)}>
            Avisar de contradicciones
          </Switch>
          <Switch on={reglas.anuncio} onChange={(v) => R("anuncio", v)}>
            Avisar cuando el pasatiempo quede resuelto
          </Switch>
          <Switch on={reglas.alcance} onChange={(v) => R("alcance", v)}>
            Sombrear las filas, columnas y cajas donde ya está el símbolo elegido
          </Switch>
        </div>
      )}

      <label style={{ display: "block", fontSize: 15, color: C.soft, marginBottom: 9 }}>
        Imagen del pasatiempo
      </label>
      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <Btn onClick={() => fileRef.current && fileRef.current.click()}>Tomar Foto</Btn>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: "none" }} onChange={onPhoto} />

        <Btn onClick={() => galRef.current && galRef.current.click()}>Elegir de la Galería</Btn>
        <input ref={galRef} type="file" accept="image/*"
          style={{ display: "none" }} onChange={onPhoto} />

        {hasImg && <Btn onClick={onStart}>Ajustar Esquinas</Btn>}
        {hayMapa && <Btn onClick={onGuardarImagen}>Guardar Imagen enderezada</Btn>}
        {hasImg && (
          <span style={{ alignSelf: "center", color: C.accent, fontSize: 14 }}>Foto cargada</span>
        )}
      </div>

      {avisoReg && (
        <p style={{
          margin: "0 0 10px", padding: "9px 12px", borderRadius: 10, fontSize: 14,
          background: C.surface, border: "1px solid " + C.line, color: C.soft,
        }}>{avisoReg}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {hayMapa && <Btn onClick={onLeer}>Leer Símbolos de la foto</Btn>}
        {hayMapa && <Btn onClick={onDetectarRegiones}>Detectar Regiones</Btn>}
        <Btn onClick={onSinFoto}>Rejilla en blanco</Btn>
      </div>

      <div style={{
        position: "sticky", bottom: 0, marginTop: 22,
        display: "flex", justifyContent: "flex-end",
        paddingTop: 12, paddingBottom: 12,
        background: "linear-gradient(to bottom, rgba(17,26,32,0), " + C.bg + " 40%)",
      }}>
        {hayMapa && (
          <button onClick={onBoard}
            style={{
              padding: "17px 34px", fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em",
              borderRadius: 14, border: "1px solid #E8B54A", background: "#E8B54A",
              color: "#1A1200", cursor: "pointer", touchAction: "manipulation",
              boxShadow: "0 6px 18px rgba(232,181,74,0.25)",
            }}>
            Ir al Tablero
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- pantalla: esquinas ---------- */
function Crop({ src, corners, setCorners, onDone, onBack, busy }) {
  const areaRef = useRef(null);
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const loupeRef = useRef(null);
  const [active, setActive] = useState(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const dragRef = useRef(null);

  // tamaño real de la foto en pantalla, calculado a mano: los porcentajes
  // no se resuelven bien dentro de un contenedor de altura automática
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setArea({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setArea({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    if (!area.w || !area.h || !nat.w || !nat.h) return { w: 0, h: 0 };
    const k = Math.min(area.w / nat.w, area.h / nat.h);
    return { w: Math.floor(nat.w * k), h: Math.floor(nat.h * k) };
  }, [area, nat]);

  // La lupa va a la esquina que quede más lejos de TODOS los puntos, no solo del
  // que se está moviendo: si no, acaba tapando alguno de los otros tres.
  const loupePos = useMemo(() => {
    // seis posiciones, no cuatro: con solo las esquinas siempre acaba tapando algún punto
    const spots = [
      { s: { left: 8, top: 8 }, x: 0, y: 0 },
      { s: { left: "calc(50% - 66px)", top: 8 }, x: 0.5, y: 0 },
      { s: { right: 8, top: 8 }, x: 1, y: 0 },
      { s: { left: 8, bottom: 8 }, x: 0, y: 1 },
      { s: { left: "calc(50% - 66px)", bottom: 8 }, x: 0.5, y: 1 },
      { s: { right: 8, bottom: 8 }, x: 1, y: 1 },
    ];
    const dist = (sp, c) => (sp.x - c.x) ** 2 + (sp.y - c.y) ** 2;

    // primero se descarta la esquina donde está el punto que se arrastra:
    // ahí la lupa taparía justo lo que se quiere ver
    let libres = spots;
    if (active != null && corners[active]) {
      let peor = 0, peorD = Infinity;
      spots.forEach((sp, i) => {
        const d = dist(sp, corners[active]);
        if (d < peorD) { peorD = d; peor = i; }
      });
      libres = spots.filter((_, i) => i !== peor);
    }

    // de las que quedan, la que esté más lejos del punto más próximo
    let best = libres[libres.length - 1], bestD = -1;
    libres.forEach((sp) => {
      let min = Infinity;
      corners.forEach((c) => { const d = dist(sp, c); if (d < min) min = d; });
      if (min > bestD) { bestD = min; best = sp; }
    });
    return best.s;
  }, [active, corners]);

  const drawLoupe = useCallback((idx) => {
    const cv = loupeRef.current, im = imgRef.current;
    if (!cv || !im || idx == null || !im.naturalWidth) return;
    const ctx = cv.getContext("2d");
    const p = corners[idx];
    const sx = p.x * im.naturalWidth, sy = p.y * im.naturalHeight;
    const half = 42;
    ctx.fillStyle = "#DDD";
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, sx - half, sy - half, half * 2, half * 2, 0, 0, cv.width, cv.height);
    ctx.strokeStyle = C.ferrari;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height);
    ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2);
    ctx.stroke();
  }, [corners]);

  useEffect(() => { drawLoupe(active); }, [active, corners, drawLoupe]);

  const move = (ev, idx) => {
    const r = boxRef.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    setCorners((cs) => cs.map((c, i) => (i === idx ? { x, y } : c)));
  };

  const nudge = (dx, dy) => {
    if (active == null) return;
    setCorners((cs) => cs.map((c, i) => (i === active
      ? { x: Math.min(1, Math.max(0, c.x + dx)), y: Math.min(1, Math.max(0, c.y + dy)) }
      : c)));
  };

  // mantener pulsada la flecha repite el desplazamiento, cada vez más rápido
  const repRef = useRef(null);
  const empezarNudge = (dx, dy) => {
    if (active == null) return;
    nudge(dx, dy);
    let espera = 320;
    const tic = () => {
      nudge(dx, dy);
      espera = Math.max(40, espera * 0.75);
      repRef.current = setTimeout(tic, espera);
    };
    repRef.current = setTimeout(tic, espera);
  };
  const pararNudge = () => {
    if (repRef.current) { clearTimeout(repRef.current); repRef.current = null; }
  };

  // Red de seguridad: si el dedo se levanta fuera del botón, o la ventana pierde
  // el foco, el aviso no llega al botón y el punto seguiría moviéndose solo.
  useEffect(() => {
    const parar = () => pararNudge();
    window.addEventListener("pointerup", parar);
    window.addEventListener("pointercancel", parar);
    window.addEventListener("blur", parar);
    return () => {
      parar();
      window.removeEventListener("pointerup", parar);
      window.removeEventListener("pointercancel", parar);
      window.removeEventListener("blur", parar);
    };
  }, []);

  const Flecha = ({ dx, dy, children }) => (
    <button
      onPointerDown={(ev) => {
        ev.preventDefault();
        try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* da igual */ }
        empezarNudge(dx, dy);
      }}
      onPointerUp={pararNudge}
      onPointerLeave={pararNudge}
      onPointerCancel={pararNudge}
      disabled={active == null}
      style={{
        border: "1px solid " + C.line, background: C.panel, color: C.ink,
        borderRadius: 11, padding: "10px 15px", fontSize: 15, fontWeight: 600,
        opacity: active == null ? 0.4 : 1, touchAction: "none",
        cursor: active == null ? "default" : "pointer",
      }}
    >{children}</button>
  );

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      padding: 10, boxSizing: "border-box", gap: 8, maxWidth: 960, margin: "0 auto",
    }}>
      <div style={{ flex: "0 0 auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn onClick={onBack}>Atrás</Btn>
        <span style={{ fontSize: 14, color: C.soft }}>Ajuste fino</span>
        <Flecha dx={-0.0007} dy={0}>←</Flecha>
        <Flecha dx={0.0007} dy={0}>→</Flecha>
        <Flecha dx={0} dy={-0.0007}>↑</Flecha>
        <Flecha dx={0} dy={0.0007}>↓</Flecha>
        <div style={{ flex: 1 }} />
        <Btn onClick={() => onDone(imgRef.current)} active disabled={busy}
          style={{ padding: "12px 20px", fontSize: 16 }}>
          {busy ? "Enderezando…" : "Enderezar"}
        </Btn>
      </div>

      <p style={{ fontSize: 13, margin: 0, color: C.soft, flex: "0 0 auto" }}>
        Puntos a las esquinas del tablero: 1 arriba‑izquierda, 2 arriba‑derecha, 3 abajo‑derecha, 4 abajo‑izquierda.
      </p>

      <div ref={areaRef} style={{
        flex: "1 1 auto", minHeight: 0, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}>
        <div ref={boxRef} style={{
          position: "relative", userSelect: "none", touchAction: "none", lineHeight: 0,
          width: fit.w || undefined, height: fit.h || undefined,
        }}>
          <img ref={imgRef} src={src} alt=""
            onLoad={(ev) => setNat({ w: ev.target.naturalWidth, h: ev.target.naturalHeight })}
            style={{ width: "100%", height: "100%", display: "block", borderRadius: 8 }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <polygon points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(" ")}
              fill="rgba(111,118,242,0.16)" stroke={C.ferrari} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {corners.map((c, i) => (
            <div
              key={i}
              onPointerDown={(ev) => {
                ev.currentTarget.setPointerCapture(ev.pointerId);
                dragRef.current = i; setActive(i); move(ev, i);
              }}
              onPointerMove={(ev) => { if (dragRef.current === i) move(ev, i); }}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
              style={{
                position: "absolute", left: `${c.x * 100}%`, top: `${c.y * 100}%`,
                width: 40, height: 40, marginLeft: -20, marginTop: -20, borderRadius: "50%",
                border: "2px solid " + (active === i ? C.ferrari : "#fff"),
                background: active === i ? "rgba(255,40,0,0.35)" : "rgba(111,118,242,0.40)",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, lineHeight: 1, touchAction: "none",
              }}
            >{i + 1}</div>
          ))}
          <canvas ref={loupeRef} width={132} height={132}
            style={{
              position: "absolute", ...loupePos, width: 132, height: 132,
              borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,.45)",
              display: active == null ? "none" : "block", pointerEvents: "none",
            }} />
        </div>
      </div>
    </div>
  );
}

/* ---------- pantalla: ayuda ---------- */
// El texto vive en Markdown para poder editarlo sin tocar el código.
const AYUDA = `**TRAMA - Cuaderno**, por Santiago Luria.

# Cómo funciona este cuaderno

Guía completa de la aplicación: para qué sirve, qué aporta y cómo usarla de principio a fin.

## Para qué sirve

Trama es un cuaderno para resolver pasatiempos de rejilla sobre una fotografía. Se fotografía el pasatiempo, se ajusta el encuadre y la aplicación coloca una rejilla encima sobre la que se puede anotar sin tocar el original.

Trama **no resuelve el pasatiempo**: es el cuaderno donde lo resuelve usted. Pone el tablero en pantalla, permite anotar encima y se ocupa de la contabilidad tediosa mientras usted piensa.

Actualmente viene preparada para tres juegos:

- **Murdoku**, que mezcla Cluedo y sudoku: un mapa de la escena de un crimen dividido en habitaciones, varios personajes con la víctima entre ellos, y pistas sobre dónde estaba cada uno. Solo hay una persona por fila y por columna, y de ahí se deduce quién quedó a solas con la víctima. Las habitaciones no limitan cuántas personas caben en ellas: sirven para interpretar las pistas.
- **Sudoku** clásico de 9×9, con sus cajas de 3×3.
- **Star Battle**, donde se colocan estrellas en una rejilla dividida en regiones irregulares: un número fijo por fila, por columna y por región, y sin que dos lleguen a tocarse.

## A qué necesidad responde

Resolver estos pasatiempos en papel tiene tres incordios. El primero, que se acaba escribiendo sobre la hoja impresa y ya no se puede reutilizar. El segundo, que borrar a lápiz deja el tablero hecho un cristo tras dos o tres cambios de idea. Y el tercero, el peor: cuando se prueba una hipótesis y resulta falsa, no hay forma limpia de volver al punto de partida.

Aquí se escribe y se borra sin gastar nada, el tablero sigue intacto debajo, y hay marcha atrás.

## Qué ventajas tiene

- **Anotaciones limpias.** Hasta nueve candidatos por casilla, ordenados solos, más el símbolo confirmado en grande.
- **Contabilidad automática.** Al confirmar un símbolo, este desaparece como candidato de donde ya no puede estar, y se tacha lo que la regla activa deje descartado.
- **Aviso de contradicciones.** Si dos confirmaciones se pisan, se señalan en rojo con el motivo.
- **Aviso al terminar.** Cuando el tablero cuadra con todas las reglas activas, la aplicación lo anuncia.
- **Marcha atrás.** Deshacer y rehacer jugada a jugada, más un punto de retorno para probar hipótesis largas.
- **Lectura de la fotografía.** La aplicación puede reconocer los símbolos impresos y las paredes de las regiones, y colocarlos por usted.
- **Nada se pierde.** La partida en curso sigue ahí al cerrar la aplicación, y los casos se pueden guardar en archivos.

## Cómo usarlo, paso a paso

### 1. Filas, columnas y símbolos

En la pantalla de Inicio se indican primero las **filas** y las **columnas**, de 3 a 16 cada una.

Después los **símbolos**, con un contador independiente del tamaño de la rejilla y un campo de texto para escribirlos como se desee. Se admite cualquier separador o ninguno: \`1 2 3\`, \`1,2,3\`, \`1-2-3\` o \`123\` dan lo mismo. Solo hace falta separador para símbolos de dos caracteres. Si los personajes de un caso se llaman Marta, Rosa y Fabio, conviene poner M R F en lugar de A B C; la V del final se reserva para la víctima (en Murdoku).

### 2. Elegir el pasatiempo

Los botones **Murdoku**, **Sudoku**, **Star Battle** y **Personalizado** dejan preparados de una vez el tamaño de la rejilla, los símbolos y las reglas. Al elegir Personalizado se despliegan los interruptores para ajustarlo todo a mano.

En Star Battle aparece además un control **Estrellas** en la pantalla de Inicio, para la variante de una, dos o más estrellas por fila, columna y región.

### 3. Reglas del tablero

Con "Ver y cambiar" se despliegan los interruptores que gobiernan el comportamiento:

- **Número fijo de casillas ocupadas por fila, columna y región**, tachando el resto. Es la regla de Murdoku y de Star Battle, con su contador al lado.
- **Ese mismo número se aplica también a cada región.** Es lo que distingue Star Battle, donde cada región admite una estrella, de Murdoku, donde en una habitación puede haber varias personas.
- **Las casillas ocupadas no pueden tocarse, ni siquiera en diagonal**, propia de Star Battle.
- **Cada símbolo una sola vez en todo el tablero**, propia de Murdoku.
- **Cada símbolo una sola vez por fila, por columna y por caja o región**, que es el sudoku.
- **El tablero tiene regiones dibujadas**, en lugar de cajas rectangulares.
- **Resaltar en verde la última casilla libre.**
- **Permitir anular casillas con una X durante la partida.**
- **Avisar de contradicciones.**
- **Avisar cuando el pasatiempo quede resuelto.**
- **Sombrear las filas, columnas y regiones donde ya está el símbolo elegido.**

De estos interruptores se deriva todo lo demás: qué se tacha solo, qué candidatos se retiran al confirmar, qué se considera un error y qué botones aparecen en el tablero.

### 4. Fotografiar el pasatiempo

Al pulsar "Tomar Foto" se abre la cámara. No hace falta puntería: la fotografía puede estar torcida y tomada en ángulo (el papel debería estar sin pliegues ni arrugas demasiado evidentes, porque deforman la imagen de manera irreparable).

Con "Elegir de la Galería" se usa una fotografía que ya esté en el dispositivo, en lugar de tomar una nueva. Y con "Rejilla en blanco" se abre el tablero sin imagen debajo, para resolver a mano o para probar la aplicación.

### 5. Ajustar las esquinas

Aparecen cuatro puntos numerados. Hay que llevarlos a las esquinas del tablero en este orden: 1 arriba a la izquierda, 2 arriba a la derecha, 3 abajo a la derecha, 4 abajo a la izquierda. Durante el arrastre, una lupa muestra ampliado el punto exacto donde está el dedo y se cambia de sitio sola para no tapar la zona que se está mirando. Las flechas de ajuste fino desplazan el punto seleccionado sin depender del pulso, y si se mantienen pulsadas repiten cada vez más rápido.

Al pulsar "Enderezar" se corrige la perspectiva y se vuelve a la pantalla de Inicio, con el tablero ya recto y encajado con la rejilla.

### 6. Leer los símbolos de la fotografía

En los pasatiempos con símbolos impresos, como el sudoku, se pulsa "Leer Símbolos de la foto".

La aplicación no intenta adivinar qué número es cada casilla. Recorta las casillas que tienen algo escrito y las **agrupa por parecido**, aprovechando que todos los símbolos de una misma fotografía comparten tipografía. Basta con indicar qué es cada grupo para que coloque todas sus casillas de una vez.

Hay dos deslizadores, ya preajustados por la aplicación:

- **Detectar** decide qué casillas se consideran ocupadas.
- **Agrupar** decide cuántos recortes se dan por el mismo símbolo. Cuanto peor sea la fotografía, más grupos saldrán.

Un mismo símbolo puede repartirse en varios grupos sin problema: se le asigna el mismo valor a todos. Lo que hay que evitar es lo contrario, que dos símbolos distintos caigan en un grupo, y por eso el ajuste automático tiende a agrupar de menos.

Los símbolos leídos entran como pistas fijas de enunciado. Si la lectura deja contradicciones, la aplicación abre el tablero directamente en el modo Fijar para corregirlas.

### 7. Detectar las regiones

En los pasatiempos con regiones dibujadas, como Star Battle, el Sudoku irregular o los mapas de Murdoku, se pulsa "Detectar Regiones". La aplicación mide el grosor de la línea que separa cada par de casillas vecinas y decide cuáles son paredes, calculando el corte a partir de la propia fotografía. Al terminar indica cuántas regiones ha encontrado.

Conviene comprobar ese número: en estos pasatiempos suele haber tantas regiones como filas, y si no coincide es que falta o sobra alguna pared.

En un sudoku, las cajas se dibujan solas al elegir el pasatiempo, siempre que el tamaño no deje lugar a dudas: 9×9 y 4×4. Se generan como paredes normales, así que pueden corregirse igual que las demás.

### 8. Corregir las paredes

El modo **Paredes** permite tocar entre dos casillas para poner una pared. Debajo de la barra aparece una paleta de diez colores, y el botón Paredes se tiñe del color activo; tocar una pared del mismo color la quita, y de otro color la recolorea. Conviene cuando el original distingue tipos de zona por color, como algunos mapas de Murdoku.

También hay un botón **Borrar todas** para vaciar las paredes de golpe, con confirmación previa. Las regiones se recalculan al instante.

Igual que las celdas fijas, las paredes quedan fuera de la acción Deshacer y no las borra la acción Vaciar: son parte del enunciado, no de la partida.

### 9. Fijar y corregir pistas

El modo **Fijar** clava un símbolo en una casilla como parte del enunciado. Se elige el símbolo en la fila de fichas y se toca la casilla; tomando la ficha X, se marcan normalmente las casillas imposibles, que es lo que necesita Murdoku para muebles, paredes y zonas bloqueadas.

Las celdas fijas quedan bloqueadas para el resto de modos, no las borra Vaciar y no entran en el historial de Deshacer. Para liberar una, se toca otra vez con el mismo símbolo; para corregirla, basta con tocarla con otro distinto. Es la forma más rápida de arreglar lo que la lectura automática haya interpretado mal.

### 10. Anotar candidatos

En el modo **Candidatos** se elige un símbolo y se tocan las casillas donde podría estar. Aparece pequeño, y caben hasta nueve por casilla. Tocar otra vez la misma casilla con el mismo símbolo lo retira. Una casilla ya confirmada no se altera desde este modo.

Las fichas de símbolo cambian de color según su estado: violeta el elegido, rojo el que ya se ha colocado por completo, y gris el que tiene algún candidato anotado en el tablero.

### 11. Tachar casillas descartadas

Durante la partida, la X se pone con una **pulsación larga** sobre una casilla libre, tanto en Candidatos como en Confirmar. Se quita con un toque normal. A diferencia de un símbolo confirmado, **no bloquea celdas ni filas ni columnas adyacentes**.

En el modo Fijar, donde se construye el enunciado, la X sí aparece como una ficha más junto a los símbolos.

### 12. Confirmar una posición

Con la certeza ya obtenida, el modo **Confirmar** coloca el símbolo en grande y en negro. Ese símbolo desaparece como candidato de donde ya no cabe, se tacha lo que la regla deje descartado (fila, columna), y su ficha se vuelve roja cuando se han colocado todas sus apariciones posibles: una en Murdoku, nueve en un sudoku. Tocar una casilla ya confirmada la vacía, sea cual sea el símbolo que tuviera.

En Star Battle, además de la fila y la columna, se tachan solas las ocho casillas de alrededor, porque dos estrellas no pueden tocarse.

### 13. Errores y pistas visuales

Las casillas que se contradicen se pintan de rojo, y encima del tablero aparece el motivo: símbolo repetido, demasiados en una fila, columna o región, dos que se tocan, o un símbolo sobre una casilla tachada.

Si se llega al punto de que no queda ninguna casilla libre pero faltan símbolos por colocar, un aviso lo indica: **la solución no puede ser correcta**.

Con la opción de **sombreado de alcance activado**, al elegir un símbolo se sombrean las filas, columnas y regiones donde ya está colocado. Las casillas que quedan sin sombrear son las únicas donde puede ir.

### 14. Cuando el pasatiempo queda resuelto

Si todo cuadra con las reglas activas, aparece un aviso verde de **Resuelto**, que se cierra tocándolo. Conviene saber qué significa exactamente: la aplicación comprueba las reglas mecánicas, no que la solución sea la del enunciado. No conoce las pistas de un Murdoku ni verifica que un sudoku tenga solución única.

### 15. Corregir: deshacer, rehacer y borrar

- **Flechas curvas.** La izquierda deshace la última jugada, la derecha la rehace. Una jugada nueva después de deshacer descarta lo rehecho.
- **Borrar.** Vacía por completo la casilla que se toque, candidatos y símbolo incluidos. No afecta a las celdas fijas.
- **Vaciar.** Limpia todas las anotaciones y el historial. Las celdas fijas y las paredes se quedan. Pide confirmación.

### 16. Probar hipótesis sin riesgo

Los dos botones de la derecha son la red de seguridad para cuando uno se atasca y quiere suponer algo a ver adónde lleva.

El botón azul con el marcador **captura el estado actual** y pone su contador a cero. A partir de ahí, el número indica cuántos cambios se llevan hechos desde esa captura. El botón de la flecha circular **devuelve el tablero a ese punto**, previa confirmación. Si la hipótesis era buena, se captura de nuevo y se sigue; si era mala, se restaura y no se ha perdido nada.

### 17. Guardar y recuperar partidas

En la pantalla de Inicio está el botón **Partidas**. Tras introducir un nombre para el caso se genera un archivo con todo: la fotografía original, el encuadre, el tablero enderezado, la rejilla, los símbolos, las paredes, las anotaciones y el historial de deshacer. El sistema pregunta entonces dónde guardarlo, de modo que puede enviarse a la carpeta que se prefiera, a Drive o a cualquier otra aplicación. Para recuperarlo, "Elegir archivo de partida". Desde esa misma pantalla se puede volver a Inicio o ir directamente al tablero.

El archivo lleva delante un distintivo del pasatiempo elegido: \`trm_murd\`, \`trm_sud\`, \`trm_star\` o \`trm_pers\`. Como el destino lo elige usted, guardar dos veces con el mismo nombre permite sobrescribir la versión anterior.

### 18. Ver mejor el tablero

La barra "Atenuar mapa", debajo del tablero en la pantalla de juego, aclara la fotografía sin borrarla. Conviene subirla si el original es oscuro o tiene muchos dibujos y cuesta leer las anotaciones encima. Atenuar la foto en Murdoku nos permite localizar fácilmente las líneas o columnas sin símbolos confirmados. En Sudoku, atenuar la foto totalmente da claridad al tablero.

El botón de las cuatro esquinas, junto al de Inicio, pasa a pantalla completa para ganar tamaño.

En la pantalla de Inicio, el botón "Guardar Imagen enderezada" permite quedarse con el tablero ya recto como fotografía aparte.

## Conviene saber

- La aplicación **no lee los enunciados ni comprueba si se cumplen**. Solo vigila las reglas mecánicas que se hayan activado.
- El **reconocimiento automático se equivoca a veces**, sobre todo con fotografías de poca calidad. Por eso conviene repasar los símbolos y las paredes antes de empezar: un fallo ahí no se nota hasta mucho después.
- Si se endereza **una fotografía distinta** a la del tablero actual, se entiende que empieza un caso nuevo y se vacía el cuaderno, con aviso previo. Con la misma fotografía se puede retocar el encuadre sin perder nada.
- La partida en curso se conserva al cerrar la aplicación, pero desaparece si se borran los datos de navegación del navegador. Lo que se quiera conservar de verdad, conviene guardarlo en un archivo.
`;

// negrita en línea: **así**
function inline(t, k) {
  const partes = String(t).split(/\*\*(.+?)\*\*/g);
  return partes.map((p, i) => (i % 2 ? <b key={k + "b" + i}>{p}</b> : p));
}

function Markdown({ texto }) {
  const lineas = texto.split("\n");
  const salida = [];
  let lista = null;

  const cerrarLista = () => {
    if (lista) {
      salida.push(
        <ul key={"u" + salida.length} style={{ paddingLeft: 22, margin: "0 0 12px" }}>{lista}</ul>
      );
      lista = null;
    }
  };

  const esItem = (t) => t.startsWith("- ") || t.startsWith("* ");

  lineas.forEach((ln, i) => {
    const l = ln.trim();
    if (!l) {
      // una línea en blanco entre dos elementos no rompe la lista
      let j = i + 1;
      while (j < lineas.length && !lineas[j].trim()) j++;
      if (lista && j < lineas.length && esItem(lineas[j].trim())) return;
      cerrarLista();
      return;
    }

    if (l.startsWith("### ")) {
      cerrarLista();
      salida.push(<h3 key={i} style={{ fontSize: 17, fontWeight: 600, margin: "22px 0 6px", color: C.accent }}>{inline(l.slice(4), i)}</h3>);
    } else if (l.startsWith("## ")) {
      cerrarLista();
      salida.push(<h2 key={i} style={{ fontSize: 21, fontWeight: 600, margin: "32px 0 10px" }}>{inline(l.slice(3), i)}</h2>);
    } else if (l.startsWith("# ")) {
      cerrarLista();
      salida.push(<h1 key={i} style={{ fontSize: 27, fontWeight: 600, margin: "0 0 8px" }}>{inline(l.slice(2), i)}</h1>);
    } else if (esItem(l)) {
      if (!lista) lista = [];
      lista.push(<li key={i} style={{ fontSize: 16, lineHeight: 1.6, marginBottom: 8 }}>{inline(l.slice(2), i)}</li>);
    } else {
      cerrarLista();
      salida.push(<p key={i} style={{ fontSize: 16, lineHeight: 1.6, margin: "0 0 12px" }}>{inline(l, i)}</p>);
    }
  });
  cerrarLista();
  return <div>{salida}</div>;
}

function Help({ onBack }) {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 18, paddingBottom: 60 }}>
      <div style={{ marginBottom: 18 }}>
        <Btn onClick={onBack}>Volver a Inicio</Btn>
      </div>
      <Markdown texto={AYUDA} />
    </div>
  );
}

/* ---------- lectura de la foto ---------- */
// No intentamos saber qué símbolo es cada celda. Recortamos las casillas con
// tinta y las agrupamos por parecido: todos los símbolos de una misma foto
// comparten tipografía, así que basta con que tú nombres cada grupo.

const NORM = 12;         // rejilla del descriptor
const MARGEN = 0.14;     // borde de la celda que se descarta, para no coger la rejilla
const TRAZO_MIN = 0.045; // tamaño mínimo del mayor trazo conexo, respecto a la celda
const PARECIDO = 0.07;   // sensibilidad de agrupación por defecto

// Otsu sobre una lista de valores: separa en dos poblaciones sin umbral fijo
function otsuLista(v) {
  const min = Math.min.apply(null, v), max = Math.max.apply(null, v);
  if (max - min < 1) return max + 1;
  const B = 64, h = new Array(B).fill(0);
  v.forEach((x) => h[Math.min(B - 1, Math.floor(((x - min) / (max - min)) * B))]++);
  let suma = 0;
  for (let i = 0; i < B; i++) suma += i * h[i];
  let sumaB = 0, wB = 0, mejor = -1, t0 = 0;
  for (let t = 0; t < B; t++) {
    wB += h[t];
    if (!wB) continue;
    const wF = v.length - wB;
    if (!wF) break;
    sumaB += t * h[t];
    const mB = sumaB / wB, mF = (suma - sumaB) / wF;
    const e = wB * wF * (mB - mF) * (mB - mF);
    if (e > mejor) { mejor = e; t0 = t; }
  }
  return min + ((t0 + 0.5) / B) * (max - min);
}

// descriptor: nivel de tinta medio en cada subcelda, normalizado por el fondo
// de esa casilla. En gris, no en blanco y negro: el moiré de una pantalla
// fotografiada destroza cualquier descriptor binario.
function descriptor(g, W, H, bx, by, bw, bh, fondo, contraste) {
  const lado = Math.max(bw, bh), ox = (lado - bw) / 2, oy = (lado - bh) / 2;
  const v = new Float32Array(NORM * NORM), cont = new Float32Array(NORM * NORM);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const gx = Math.min(NORM - 1, Math.floor((x / lado) * NORM));
      const gy = Math.min(NORM - 1, Math.floor((y / lado) * NORM));
      cont[gy * NORM + gx]++;
      if (x < ox || y < oy || x >= ox + bw || y >= oy + bh) continue;
      const sx = Math.round(bx + x - ox), sy = Math.round(by + y - oy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const t = (fondo - g[sy * W + sx]) / contraste;
      v[gy * NORM + gx] += Math.max(0, Math.min(1, t));
    }
  }
  for (let i = 0; i < v.length; i++) v[i] = cont[i] ? v[i] / cont[i] : 0;
  return { v, aspecto: bw / bh };
}

function distancia(a, b) {
  let d = 0;
  for (let i = 0; i < a.v.length; i++) d += Math.abs(a.v[i] - b.v[i]);
  d /= a.v.length;
  const da = Math.abs(a.aspecto - b.aspecto) / Math.max(a.aspecto, b.aspecto);
  return d + 0.35 * Math.min(1, da);
}

// mayor mancha de tinta conexa dentro de la casilla
function mayorTrazo(g, W, x0, y0, aw, ah, umbral) {
  const marca = new Uint8Array(aw * ah);
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) marca[y * aw + x] = g[(y0 + y) * W + (x0 + x)] < umbral ? 1 : 0;
  }
  const vis = new Uint8Array(aw * ah), pila = [];
  let mayor = 0;
  for (let i = 0; i < marca.length; i++) {
    if (!marca[i] || vis[i]) continue;
    let n = 0;
    pila.length = 0; pila.push(i); vis[i] = 1;
    while (pila.length) {
      const q = pila.pop(); n++;
      const qx = q % aw, qy = (q / aw) | 0;
      if (qx + 1 < aw && marca[q + 1] && !vis[q + 1]) { vis[q + 1] = 1; pila.push(q + 1); }
      if (qx > 0 && marca[q - 1] && !vis[q - 1]) { vis[q - 1] = 1; pila.push(q - 1); }
      if (qy + 1 < ah && marca[q + aw] && !vis[q + aw]) { vis[q + aw] = 1; pila.push(q + aw); }
      if (qy > 0 && marca[q - aw] && !vis[q - aw]) { vis[q - aw] = 1; pila.push(q - aw); }
    }
    if (n > mayor) mayor = n;
  }
  return mayor / (aw * ah);
}

// analiza la rejilla y devuelve las casillas con algo escrito
function analizarRejilla(img, rows, cols, sens) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;

  const crudo = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    crudo[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  }
  // suavizado 3x3: quita el moiré de las fotos de pantalla
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          sum += crudo[ny * W + nx]; n++;
        }
      }
      g[y * W + x] = sum / n;
    }
  }

  const cw = W / cols, ch = H / rows;
  const brutas = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(c * cw + cw * MARGEN), x1 = Math.round((c + 1) * cw - cw * MARGEN);
      const y0 = Math.round(r * ch + ch * MARGEN), y1 = Math.round((r + 1) * ch - ch * MARGEN);
      const aw = x1 - x0, ah = y1 - y0;
      if (aw < 6 || ah < 6) continue;

      const vals = [];
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) vals.push(g[(y0 + y) * W + (x0 + x)]);
      vals.sort((a, b) => a - b);
      const q = (f) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))];
      const fondo = q(0.80), contraste = Math.max(1, fondo - q(0.03));
      const umbral = fondo - 0.45 * contraste;

      let minX = aw, maxX = -1, minY = ah, maxY = -1;
      for (let y = 0; y < ah; y++) {
        for (let x = 0; x < aw; x++) {
          if (g[(y0 + y) * W + (x0 + x)] < umbral) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) continue;
      brutas.push({
        r, c, x0, y0, aw, ah, fondo, contraste, umbral,
        trazo: mayorTrazo(g, W, x0, y0, aw, ah, umbral),
        bx: x0 + minX, by: y0 + minY, bw: maxX - minX + 1, bh: maxY - minY + 1,
      });
    }
  }
  if (!brutas.length) return { brutas: [], umbC: 0 };

  brutas.forEach((b) => {
    b.id = `${b.r}:${b.c}`;
    b.desc = descriptor(g, W, H, b.bx, b.by, b.bw, b.bh, b.fondo, b.contraste);
    b.rect = { x: b.bx, y: b.by, w: b.bw, h: b.bh };
    // descartes de forma: restos de línea de la rejilla
    b.forma = !(b.bw > b.aw * 0.9 && b.bh < b.ah * 0.25) &&
              !(b.bh > b.ah * 0.9 && b.bw < b.aw * 0.25);
  });

  // el corte de contraste sale de la propia imagen, no de un número fijo
  return { brutas, umbC: otsuLista(brutas.map((b) => b.contraste)) };
}

function filtrar(brutas, umbC, sens) {
  const u = umbC * sens;
  return brutas.filter((b) => b.forma && b.contraste >= u && b.trazo >= TRAZO_MIN);
}

// Sensibilidad recomendada: se prefiere el corte calculado por la imagen si
// cae en una zona estable; si no, el centro de la meseta más ancha del barrido.
function recomendarSens(brutas, umbC) {
  const pasos = [];
  for (let k = 0.6; k <= 1.401; k += 0.05) {
    pasos.push({ k: Math.round(k * 100) / 100, n: filtrar(brutas, umbC, k).length });
  }
  const i1 = pasos.findIndex((p) => Math.abs(p.k - 1) < 0.001);
  let a = i1, b = i1;
  while (a > 0 && pasos[a - 1].n === pasos[i1].n) a--;
  while (b < pasos.length - 1 && pasos[b + 1].n === pasos[i1].n) b++;
  if (pasos[i1].n > 0 && b - a + 1 >= 3) return 1;

  let ini = 0, len = 0, i = 0;
  while (i < pasos.length) {
    let j = i;
    while (j + 1 < pasos.length && pasos[j + 1].n === pasos[i].n) j++;
    if (pasos[i].n > 0 && j - i + 1 > len) { len = j - i + 1; ini = i; }
    i = j + 1;
  }
  return len ? pasos[ini + ((len - 1) >> 1)].k : 1;
}

// Agrupación recomendada: por encima de casi todas las distancias al vecino
// más cercano (que suelen ser del mismo símbolo) y por debajo del salto a
// símbolos distintos. Con margen a la baja: fundir dos números cuesta caro.
function recomendarParecido(celdas) {
  if (celdas.length < 3) return PARECIDO;
  const nn = celdas.map((a) => {
    let m = Infinity;
    celdas.forEach((b) => {
      if (a === b) return;
      const d = distancia(a.desc, b.desc);
      if (d < m) m = d;
    });
    return m;
  }).sort((x, y) => x - y);
  const p90 = nn[Math.min(nn.length - 1, Math.floor(0.9 * nn.length))];
  return Math.max(0.02, Math.min(0.2, Math.round(p90 * 1.15 * 100) / 100));
}

// agrupación voraz contra el primer miembro: sin promediar, para que un grupo
// no vaya derivando y acabe tragándose símbolos distintos
function agrupar(celdas, umbralP) {
  const grupos = [];
  celdas.forEach((cel) => {
    let mejor = -1, mejorD = Infinity;
    grupos.forEach((g, gi) => {
      const d = distancia(cel.desc, g.modelo);
      if (d < mejorD) { mejorD = d; mejor = gi; }
    });
    if (mejor >= 0 && mejorD < umbralP) grupos[mejor].celdas.push(cel.id);
    else grupos.push({ celdas: [cel.id], modelo: cel.desc, rect: cel.rect });
  });
  grupos.sort((a, b) => b.celdas.length - a.celdas.length);
  return grupos;
}

function miniatura(img, rect) {
  const t = document.createElement("canvas");
  t.width = 56; t.height = 56;
  const tc = t.getContext("2d");
  tc.fillStyle = "#fff";
  tc.fillRect(0, 0, 56, 56);
  const m = 6, k = Math.min((56 - m * 2) / rect.w, (56 - m * 2) / rect.h);
  const dw = rect.w * k, dh = rect.h * k;
  tc.drawImage(img, rect.x, rect.y, rect.w, rect.h, (56 - dw) / 2, (56 - dh) / 2, dw, dh);
  return t.toDataURL("image/png");
}

// ---------- detección de las paredes gruesas que delimitan regiones ----------
// Para cada frontera entre dos casillas se mide el grosor de la línea que las
// separa; el corte entre pared y línea fina sale de la propia imagen.
function detectarParedes(img, rows, cols) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, W, H).data;
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  }

  const cw = W / cols, ch = H / rows;
  const R = Math.max(4, Math.round(Math.min(cw, ch) * 0.11)); // radio de exploración

  // Perfil de la frontera promediado a lo largo con mediana: así los dígitos
  // cercanos y la textura del papel se diluyen en lugar de disparar la medida.
  // El área de oscuridad de ese perfil separa pared de línea fina.
  const area = (vertical, r, c) => {
    const centro = Math.round(vertical ? (c + 1) * cw : (r + 1) * ch);
    const ini = Math.round(vertical ? r * ch + ch * 0.18 : c * cw + cw * 0.18);
    const fin = Math.round(vertical ? r * ch + ch * 0.82 : c * cw + cw * 0.82);
    const perfil = [];
    for (let d = -R; d <= R; d++) {
      const vals = [];
      for (let t = ini; t < fin; t++) {
        const x = vertical ? centro + d : t;
        const y = vertical ? t : centro + d;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        vals.push(g[y * W + x]);
      }
      if (!vals.length) { perfil.push(255); continue; }
      vals.sort((a, b) => a - b);
      perfil.push(vals[vals.length >> 1]);
    }
    const fondo = Math.max.apply(null, perfil);
    return perfil.reduce((acc, v) => acc + Math.max(0, fondo - v), 0);
  };

  const medidas = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) medidas.push({ k: "v" + r + "," + c, g: area(true, r, c) });
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) medidas.push({ k: "h" + r + "," + c, g: area(false, r, c) });
  }
  return { medidas, corte: otsuLista(medidas.map((m) => m.g)) };
}

// componentes conexas a partir de las paredes
function regionesDe(walls, rows, cols) {
  const reg = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (reg[r][c] >= 0) continue;
      const id = n++;
      const pila = [[r, c]];
      reg[r][c] = id;
      while (pila.length) {
        const [y, x] = pila.pop();
        if (x + 1 < cols && reg[y][x + 1] < 0 && !walls["v" + y + "," + x]) { reg[y][x + 1] = id; pila.push([y, x + 1]); }
        if (x - 1 >= 0 && reg[y][x - 1] < 0 && !walls["v" + y + "," + (x - 1)]) { reg[y][x - 1] = id; pila.push([y, x - 1]); }
        if (y + 1 < rows && reg[y + 1][x] < 0 && !walls["h" + y + "," + x]) { reg[y + 1][x] = id; pila.push([y + 1, x]); }
        if (y - 1 >= 0 && reg[y - 1][x] < 0 && !walls["h" + (y - 1) + "," + x]) { reg[y - 1][x] = id; pila.push([y - 1, x]); }
      }
    }
  }
  return { reg, n };
}

function Leer({ img, rows, cols, palette, onAplicar, onBack }) {
  const [estado, setEstado] = useState("cargando");
  const [analisis, setAnalisis] = useState(null);
  const [sens, setSens] = useState(1);
  const [umbralP, setUmbralP] = useState(PARECIDO);
  const [reco, setReco] = useState(null);
  const [sel, setSel] = useState({});
  const imgRef = useRef(null);

  useEffect(() => {
    if (!img) { setEstado("sinfoto"); return; }
    const im = new Image();
    im.onload = () => {
      try {
        imgRef.current = im;
        const a = analizarRejilla(im, rows, cols);
        setAnalisis(a);
        if (!a.brutas.length) { setEstado("vacio"); return; }

        // preajuste automático de los dos controles
        const kk = recomendarSens(a.brutas, a.umbC);
        const cs = filtrar(a.brutas, a.umbC, kk);
        const pp = recomendarParecido(cs);
        setSens(kk); setUmbralP(pp); setReco({ sens: kk, parecido: pp });
        setEstado(cs.length ? "listo" : "vacio");
      } catch (e) { setEstado("error"); }
    };
    im.onerror = () => setEstado("error");
    im.src = img;
  }, [img, rows, cols]);

  const celdas = useMemo(
    () => (analisis ? filtrar(analisis.brutas, analisis.umbC, sens) : []),
    [analisis, sens]
  );

  // al mover cualquier control se recalcula al vuelo, sin releer la foto
  const grupos = useMemo(() => {
    if (!celdas.length || !imgRef.current) return [];
    const gs = agrupar(celdas, umbralP);
    gs.forEach((g) => { g.thumb = miniatura(imgRef.current, g.rect); });
    return gs;
  }, [celdas, umbralP]);

  useEffect(() => { setSel({}); }, [umbralP, sens]);

  const clave = (g) => g.celdas[0];
  const asignados = grupos.reduce((n, g) => n + (sel[clave(g)] ? g.celdas.length : 0), 0);
  const enReco = reco && Math.abs(sens - reco.sens) < 0.001 && Math.abs(umbralP - reco.parecido) < 0.001;

  const aplicar = () => {
    const mapa = {};
    grupos.forEach((g) => {
      const s = sel[clave(g)];
      if (!s) return;
      g.celdas.forEach((id) => { mapa[id] = s; });
    });
    onAplicar(mapa);
  };

  const control = (etiqueta, ayuda, valor, min, max, paso, set, dato) => (
    <div style={{
      marginBottom: 14, padding: 12,
      background: C.surface, border: "1px solid " + C.line, borderRadius: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 15, color: C.ink, whiteSpace: "nowrap", minWidth: 74 }}>{etiqueta}</span>
        <input type="range" min={min} max={max} step={paso} value={valor}
          onChange={(ev) => set(Number(ev.target.value))}
          style={{ flex: 1, accentColor: C.accent }} />
        <span style={{ fontSize: 14, color: C.soft, whiteSpace: "nowrap", minWidth: 78, textAlign: "right" }}>
          {dato}
        </span>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13, color: C.soft, lineHeight: 1.45 }}>{ayuda}</p>
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 18, paddingBottom: 50 }}>
      <div style={{ marginBottom: 18 }}>
        <Btn onClick={onBack}>Volver</Btn>
      </div>

      <h2 style={{ fontSize: 21, fontWeight: 600, margin: "0 0 8px" }}>Leer los símbolos de la foto</h2>

      {estado === "cargando" && <p style={{ color: C.soft }}>Analizando la imagen…</p>}
      {estado === "sinfoto" && <p style={{ color: C.soft }}>No hay ninguna foto enderezada todavía.</p>}
      {estado === "error" && <p style={{ color: C.warn }}>No se ha podido analizar la imagen.</p>}
      {estado === "vacio" && (
        <p style={{ color: C.soft, lineHeight: 1.5 }}>
          No se ha encontrado nada escrito dentro de las casillas. Compruebe que el encuadre
          de las esquinas sea exacto y que la fotografía tenga buena luz.
        </p>
      )}

      {estado === "listo" && (
        <>
          <p style={{ color: C.soft, fontSize: 15, lineHeight: 1.5, margin: "0 0 16px" }}>
            Si es necesario, ajuste los deslizadores de control de detección automática.
          </p>

          {control("Detectar",
            "Detección del número de casillas ocupadas.",
            sens, 0.6, 1.4, 0.05, setSens,
            celdas.length + (celdas.length === 1 ? " casilla" : " casillas"))}

          {control("Agrupar",
            "Sensibilidad de la función de reconocimiento de caracteres (lo ideal sería que reconociera 9). Aumente este número si la calidad de la foto es mala.",
            umbralP, 0.02, 0.20, 0.01, setUmbralP,
            grupos.length + (grupos.length === 1 ? " grupo" : " grupos"))}

          {reco && !enReco && (
            <div style={{ marginBottom: 16 }}>
              <Btn onClick={() => { setSens(reco.sens); setUmbralP(reco.parecido); }}>
                Volver al ajuste recomendado
              </Btn>
            </div>
          )}

          <p style={{ color: C.soft, fontSize: 15, lineHeight: 1.5, margin: "0 0 16px" }}>
            Indique qué es cada grupo; los que deje en blanco se ignoran. Un mismo símbolo
            puede aparecer en varios grupos.
          </p>

          {grupos.map((g) => {
            const k = clave(g);
            return (
              <div key={k} style={{
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                padding: 12, marginBottom: 10,
                background: C.surface, border: "1px solid " + C.line, borderRadius: 12,
              }}>
                <img src={g.thumb} alt="" width={56} height={56}
                  style={{ borderRadius: 8, background: "#fff", flex: "0 0 auto" }} />
                <span style={{ fontSize: 14, color: C.soft, minWidth: 84 }}>
                  {g.celdas.length} {g.celdas.length === 1 ? "casilla" : "casillas"}
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {palette.map((L) => (
                    <button key={L}
                      onClick={() => setSel((s) => ({ ...s, [k]: s[k] === L ? null : L }))}
                      style={{
                        width: 40, height: 40, borderRadius: 10, fontSize: 17, fontWeight: 700,
                        border: "1px solid " + (sel[k] === L ? C.accent : C.line),
                        background: sel[k] === L ? C.accent : C.panel,
                        color: sel[k] === L ? C.accentInk : C.ink,
                        cursor: "pointer", touchAction: "manipulation",
                      }}>{L}</button>
                  ))}
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <Btn active onClick={aplicar} disabled={!asignados}>
              Colocar {asignados} {asignados === 1 ? "símbolo" : "símbolos"}
            </Btn>
            <Btn onClick={onBack}>Cancelar</Btn>
          </div>

          <p style={{ color: C.soft, fontSize: 14, lineHeight: 1.5, marginTop: 18 }}>
            Entran como pistas fijas. Conviene repasarlas sobre el tablero antes de empezar: un
            símbolo mal leído estropea la deducción entera y no se nota hasta mucho después.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------- pantalla: partidas en archivo ---------- */
function Saves({ onSave, onOpen, onBack, onTablero, hayMapa, tieneNotas, aviso }) {
  const [nombre, setNombre] = useState("");
  const fileRef = useRef(null);

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 18 }}>
      <div style={{ marginBottom: 20 }}>
        <Btn onClick={onBack}>Volver a Inicio</Btn>
        {hayMapa && <Btn onClick={onTablero} active>Ir al Tablero</Btn>}
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>Guardar en archivo</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          value={nombre}
          onChange={(ev) => setNombre(ev.target.value)}
          placeholder="Identificador de tu partida"
          style={{
            flex: "1 1 220px", padding: "12px 14px", fontSize: 16,
            border: "1px solid " + C.line, borderRadius: 11,
            background: C.surface, color: C.ink, outlineColor: C.accent,
          }}
        />
        <Btn active onClick={() => { onSave(nombre); setNombre(""); }} disabled={!tieneNotas}>
          Guardar partida
        </Btn>
      </div>
      <p style={{ fontSize: 14, color: C.soft, margin: "0 0 30px", lineHeight: 1.5 }}>
        Se genera un archivo con todo: la fotografía original, el encuadre de las esquinas, el
        mapa enderezado, la rejilla, los personajes, las anotaciones y la pila de Deshacer.
        El sistema preguntará dónde guardarlo.
      </p>

      <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>Abrir una partida</h2>
      <Btn onClick={() => fileRef.current && fileRef.current.click()}
        style={{ padding: "14px 20px", fontSize: 16 }}>
        Elegir archivo de partida
      </Btn>
      <input ref={fileRef} type="file" style={{ display: "none" }}
        onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) onOpen(f); }} />
      <p style={{ fontSize: 14, color: C.soft, margin: "10px 0 0", lineHeight: 1.5 }}>
        Busque el archivo guardado anteriormente. La partida se restaura tal y como quedó.
      </p>

      {aviso && (
        <p style={{
          padding: "10px 12px", borderRadius: 8, marginTop: 22, fontSize: 14,
          background: "rgba(255,40,0,0.16)", border: "1px solid " + C.ferrari, color: "#FFB3A2",
        }}>{aviso}</p>
      )}
    </div>
  );
}

// contradicciones, según los ámbitos de unicidad activos
function calcularErrores(cells, reglas, mapaReg, ctx) {
  const bad = {}, kinds = {};
  if (!reglas.errores) return { bad, names: [], count: 0 };

  const enCaja = (r, c) =>
    (reglas.regiones && mapaReg && mapaReg[r])
      ? "r" + mapaReg[r][c]
      : Math.floor(r / reglas.cajaR) + ":" + Math.floor(c / reglas.cajaC);

  const conf = Object.entries(cells)
    .filter((e) => e[1] && e[1].conf)
    .map((e) => {
      const p = e[0].split(":");
      return { id: e[0], r: Number(p[0]), c: Number(p[1]), L: e[1].conf };
    });

  const flag = (id, kind) => { bad[id] = true; kinds[kind] = true; };

  conf.forEach((a, i) => {
    if (cells[a.id] && cells[a.id].x) flag(a.id, "tachada");
    conf.forEach((b, j) => {
      if (i >= j) return;
      const mismo = a.L === b.L;
      if (reglas.simboloTablero && mismo) { flag(a.id, "repetida"); flag(b.id, "repetida"); }
      if (reglas.adyacencia && Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1) {
        flag(a.id, "juntas"); flag(b.id, "juntas");
      }
      if (reglas.simboloFila && mismo && a.r === b.r) { flag(a.id, "simFila"); flag(b.id, "simFila"); }
      if (reglas.simboloCol && mismo && a.c === b.c) { flag(a.id, "simCol"); flag(b.id, "simCol"); }
      if (reglas.simboloCaja && mismo && enCaja(a.r, a.c) === enCaja(b.r, b.c)) {
        flag(a.id, "simCaja"); flag(b.id, "simCaja");
      }
    });
  });

  // exceso de ocupación por fila o por columna
  if (reglas.ocupacionUnica) {
    const n = Math.max(1, reglas.porLinea || 1);
    const porF = {}, porC = {};
    conf.forEach((a) => {
      (porF[a.r] = porF[a.r] || []).push(a.id);
      (porC[a.c] = porC[a.c] || []).push(a.id);
    });
    Object.values(porF).forEach((ids) => {
      if (ids.length > n) ids.forEach((id) => flag(id, "fila"));
    });
    Object.values(porC).forEach((ids) => {
      if (ids.length > n) ids.forEach((id) => flag(id, "columna"));
    });
    // en Murdoku las habitaciones no limitan: puede haber varias personas en una
    if (reglas.regiones && reglas.ocupaRegion && mapaReg) {
      const porR = {};
      conf.forEach((a) => { const k = enCaja(a.r, a.c); (porR[k] = porR[k] || []).push(a.id); });
      Object.values(porR).forEach((ids) => {
        if (ids.length > n) ids.forEach((id) => flag(id, "region"));
      });
    }
  }

  // con el tablero completo, una línea o región con menos de las debidas es un fallo
  if (reglas.ocupacionUnica && ctx && ctx.completo) {
    const n = Math.max(1, reglas.porLinea || 1);
    const cuenta = (clave) => {
      const m = {};
      conf.forEach((a) => { const k = clave(a); m[k] = (m[k] || 0) + 1; });
      return m;
    };
    const corto = (m, total) => {
      for (let i = 0; i < total; i++) if ((m[i] || 0) < n) return true;
      return false;
    };
    if (corto(cuenta((a) => a.r), ctx.rows) || corto(cuenta((a) => a.c), ctx.cols)) {
      kinds.faltan = true;
    }
  }

  const names = [];
  if (kinds.repetida) names.push("símbolo repetido en el tablero");
  if (kinds.fila) names.push("demasiadas en una fila");
  if (kinds.columna) names.push("demasiadas en una columna");
  if (kinds.juntas) names.push("dos que se tocan");
  if (kinds.region) names.push("demasiadas en una región");
  if (kinds.faltan) names.push("faltan símbolos por colocar");
  if (kinds.simFila) names.push("símbolo repetido en una fila");
  if (kinds.simCol) names.push("símbolo repetido en una columna");
  if (kinds.simCaja) names.push(reglas.regiones ? "símbolo repetido en una región" : "símbolo repetido en una caja");
  if (kinds.tachada) names.push("sobre casilla tachada");
  return { bad, names, count: Object.keys(bad).length };
}

/* ---------- pantalla: tablero ---------- */
function Board({
  rows, cols, palette, reglas, img, board, apply, applyFixed, mode, setMode,
  letter, setLetter, dim, setDim,
  undo, canUndo, redo, canRedo, marcar, volver, snapN, haySnap,
  clearAll, onSettings,
}) {
  const wrapRef = useRef(null);
  const areaRef = useRef(null);
  const letrasRef = useRef(null);
  const [anchoLetras, setAnchoLetras] = useState(0);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [full, setFull] = useState(false);
  const [fijarVacio, setFijarVacio] = useState(false);
  const [pincel, setPincel] = useState("n"); // color activo para las paredes
  const [cerrado, setCerrado] = useState(false);
  useEffect(() => { if (!reglas.tachado) setFijarVacio(false); }, [reglas.tachado]);
  const { cells, fixed } = board;
  const walls = board.walls || {};

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setArea({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setArea({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = letrasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setAnchoLetras(e[0].contentRect.width));
    ro.observe(el);
    setAnchoLetras(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  const pantallaCompleta = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* algunos navegadores no lo permiten */ }
  };

  // el tablero se encaja en el hueco que quede, nunca desborda la pantalla
  const tam = useMemo(() => {
    if (!area.w || !area.h) return { w: 0, h: 0 };
    const k = Math.min(area.w / cols, area.h / rows);
    return { w: Math.floor(k * cols), h: Math.floor(k * rows) };
  }, [area, rows, cols]);

  const cell = (tam.w || area.w || 600) / cols;

  // las fichas ocupan como mucho el 80% del ancho; si no caben, se reparten
  // en varias filas equilibradas para no dejar letras sueltas abajo
  const filas = useMemo(() => {
    // la X solo aparece al construir el enunciado; en juego va con pulsación larga
    const items = (reglas.tachado && mode === "fixx") ? [...palette, "\u00d7"] : [...palette];
    const util = (anchoLetras || 600) * 0.8;
    const porFila = Math.max(1, Math.floor((util + HUECO) / (FICHA + HUECO)));
    const nFilas = Math.ceil(items.length / porFila);
    const cupo = Math.ceil(items.length / nFilas);
    const out = [];
    for (let i = 0; i < items.length; i += cupo) out.push(items.slice(i, i + cupo));
    return out;
  }, [palette, anchoLetras, reglas.tachado, mode]);

  // con la regla de no tocarse, las ocho casillas de alrededor quedan descartadas
  const vecinas = useMemo(() => {
    const out = {};
    if (!reglas.adyacencia) return out;
    Object.entries(cells).forEach(([id, v]) => {
      if (!v || !v.conf) return;
      const p = id.split(":");
      const r = Number(p[0]), c = Number(p[1]);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          out[nr + ":" + nc] = true;
        }
      }
    });
    return out;
  }, [cells, reglas.adyacencia, rows, cols]);

  const { reg: mapaReg, n: nReg } = useMemo(
    () => regionesDe(walls, rows, cols), [walls, rows, cols]
  );

  // el ámbito de agrupación es la región dibujada, si la hay, o la caja rectangular
  const caja = (r, c) =>
    reglas.regiones
      ? "r" + (mapaReg[r] ? mapaReg[r][c] : 0)
      : Math.floor(r / reglas.cajaR) + ":" + Math.floor(c / reglas.cajaC);

  // un símbolo se da por colocado cuando ya no cabe ninguno más
  const cupo = useMemo(() => {
    let n = Infinity;
    if (reglas.simboloTablero) n = 1;
    if (reglas.ocupacionUnica) {
      n = Math.min(n, Math.max(1, reglas.porLinea || 1) * Math.min(rows, cols));
    }
    if (reglas.simboloFila) n = Math.min(n, rows);
    if (reglas.simboloCol) n = Math.min(n, cols);
    return n;
  }, [reglas, rows, cols]);

  // símbolos que tienen algún candidato anotado en el tablero
  const conCandidatos = useMemo(() => {
    const s = {};
    Object.values(cells).forEach((v) => {
      if (v && v.cand) v.cand.forEach((L) => { s[L] = true; });
    });
    return s;
  }, [cells]);

  const cuenta = useMemo(() => {
    const s = {};
    Object.values(cells).forEach((v) => { if (v && v.conf) s[v.conf] = (s[v.conf] || 0) + 1; });
    return s;
  }, [cells]);

  const confirmedLetters = useMemo(() => {
    const s = {};
    Object.keys(cuenta).forEach((L) => { if (cuenta[L] >= cupo) s[L] = true; });
    return s;
  }, [cuenta, cupo]);

  // filas, columnas y cajas donde el símbolo elegido ya está confirmado
  const alcance = useMemo(() => {
    const F = {}, K = {}, B = {};
    if (!reglas.alcance || !letter) return { F, K, B };
    Object.entries(cells).forEach(([id, v]) => {
      if (!v || v.conf !== letter) return;
      const p = id.split(":");
      const r = Number(p[0]), c = Number(p[1]);
      if (reglas.simboloFila) F[r] = true;
      if (reglas.simboloCol) K[c] = true;
      if (reglas.simboloCaja) B[caja(r, c)] = true;
    });
    return { F, K, B };
  }, [cells, letter, reglas]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocked = useMemo(() => {
    const R = {}, K = {};
    if (!reglas.ocupacionUnica) return { R, K };
    const n = Math.max(1, reglas.porLinea || 1);
    const cf = {}, cc = {};
    Object.entries(cells).forEach(([id, v]) => {
      if (!v || !v.conf) return;
      const p = id.split(":");
      cf[p[0]] = (cf[p[0]] || 0) + 1;
      cc[p[1]] = (cc[p[1]] || 0) + 1;
    });
    Object.keys(cf).forEach((k) => { if (cf[k] >= n) R[k] = true; });
    Object.keys(cc).forEach((k) => { if (cc[k] >= n) K[k] = true; });
    return { R, K };
  }, [cells, reglas.ocupacionUnica, reglas.porLinea]);


  // el tablero está completo cuando no queda ninguna casilla sin símbolo ni tachar
  const completo = useMemo(() => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r + ":" + c;
        const v = cells[id];
        if (v && (v.conf || v.x)) continue;
        if (fixed[id]) continue;
        if (blocked.R[String(r)] || blocked.K[String(c)] || vecinas[id]) continue;
        return false;
      }
    }
    return true;
  }, [rows, cols, cells, fixed, blocked, vecinas]);

  const errors = useMemo(
    () => calcularErrores(cells, reglas, mapaReg, { rows, cols, completo }),
    [cells, reglas, mapaReg, rows, cols, completo]
  );

  // sin regla de ocupación (sudoku), resuelto exige símbolo en todas las casillas
  const todasConSimbolo = useMemo(() => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = cells[r + ":" + c];
        if (!v || !v.conf) return false;
      }
    }
    return true;
  }, [cells, rows, cols]);

  const resuelto = reglas.anuncio && reglas.errores &&
    errors.count === 0 && errors.names.length === 0 &&
    (reglas.ocupacionUnica ? completo : todasConSimbolo);


  // Poner X: pulsación larga sobre una casilla libre, en cualquier modo de juego.
  // Quitarla: un toque normal. Las celdas fijas no responden a ninguno de los dos.
  const largaRef = useRef(null);
  const hizoLarga = useRef(false);

  const pulsarCasilla = (r, c) => {
    const id = `${r}:${c}`;
    hizoLarga.current = false;
    if (mode !== "cand" && mode !== "conf") return;
    if (fixed[id]) return;
    const v = cells[id] || { cand: [], conf: null, x: false };
    if (v.x || v.conf) return; // ya ocupada: el toque se encarga
    largaRef.current = setTimeout(() => {
      hizoLarga.current = true;
      largaRef.current = null;
      apply((b) => {
        const cur = b.cells[id] || { cand: [], conf: null, x: false };
        const nc = { ...b.cells };
        nc[id] = { ...cur, x: true };
        return { ...b, cells: nc };
      });
    }, 380);
  };

  const soltarCasilla = () => {
    if (largaRef.current) { clearTimeout(largaRef.current); largaRef.current = null; }
  };

  useEffect(() => soltarCasilla, []);

  const tap = (r, c) => {
    if (hizoLarga.current) { hizoLarga.current = false; return; } // ya se puso la X
    const id = `${r}:${c}`;
    const cur0 = cells[id] || { cand: [], conf: null, x: false };
    const esPista = !!fixed[id] && !!cur0.conf;

    if (mode === "fixx") {
      // fuera del historial: las celdas fijas no se deshacen ni se restauran
      const simbolo = (fijarVacio && reglas.tachado) ? null : letter;
      applyFixed((b) => {
        const nf = { ...b.fixed }, nc = { ...b.cells };
        const cur = b.cells[id] || { cand: [], conf: null, x: false };
        const igual = !!nf[id] && (cur.conf || null) === simbolo;
        if (igual) {
          delete nf[id];
          const next = { ...cur, conf: null };
          if (!next.cand.length && !next.x) delete nc[id]; else nc[id] = next;
        } else {
          nf[id] = true;
          const next = { ...cur, conf: simbolo, x: false };
          if (!next.conf && !next.cand.length) delete nc[id]; else nc[id] = next;
        }
        return { ...b, cells: nc, fixed: nf };
      });
      return;
    }

    if (fixed[id] || esPista) return; // el enunciado solo se toca desde Fijar

    if (mode === "wall") return;

    if (mode === "erase") {
      apply((b) => {
        if (!b.cells[id]) return b;
        const nc = { ...b.cells };
        delete nc[id];
        return { ...b, cells: nc };
      });
      return;
    }

    // una X se quita con un toque, se esté en el modo que se esté
    if (cur0.x) {
      apply((b) => {
        const cur = b.cells[id] || { cand: [], conf: null, x: false };
        const nc = { ...b.cells };
        const next = { ...cur, x: false };
        if (!next.conf && !next.cand.length) delete nc[id]; else nc[id] = next;
        return { ...b, cells: nc };
      });
      return;
    }

    if (mode === "conf") {
      apply((b) => {
        const cur = b.cells[id] || { cand: [], conf: null, x: false };
        const nc = { ...b.cells };
        if (cur.conf) {
          // casilla ya confirmada: el toque la vacía, sea cual sea el símbolo
          const next = { ...cur, conf: null };
          if (!next.cand.length && !next.x) delete nc[id]; else nc[id] = next;
          return { ...b, cells: nc };
        }
        // el símbolo deja de ser candidato allí donde ya no puede estar
        Object.keys(nc).forEach((k) => {
          const v = nc[k];
          if (!v.cand || v.cand.indexOf(letter) < 0) return;
          const p = k.split(":");
          const kr = Number(p[0]), kc = Number(p[1]);
          const afecta = reglas.simboloTablero
            || (reglas.simboloFila && kr === r)
            || (reglas.simboloCol && kc === c)
            || (reglas.simboloCaja && caja(kr, kc) === caja(r, c));
          if (!afecta) return;
          const limpio = { ...v, cand: v.cand.filter((x) => x !== letter) };
          if (!limpio.conf && !limpio.cand.length && !limpio.x) delete nc[k]; else nc[k] = limpio;
        });
        const base = nc[id] || { cand: [], conf: null, x: false };
        nc[id] = { ...base, conf: letter };
        return { ...b, cells: nc };
      });
      return;
    }

    // modo Candidatos: el toque alterna el símbolo elegido
    if (cur0.conf) return; // una confirmación no se toca desde aquí
    apply((b) => {
      const cur = b.cells[id] || { cand: [], conf: null, x: false };
      const nc = { ...b.cells };
      const has = cur.cand.indexOf(letter) >= 0;
      let next;
      if (has) next = { ...cur, cand: cur.cand.filter((x) => x !== letter) };
      else if (cur.cand.length >= 9) return b;
      else next = { ...cur, cand: sortCand([...cur.cand, letter], palette) };
      if (!next.conf && !next.cand.length && !next.x) delete nc[id]; else nc[id] = next;
      return { ...b, cells: nc };
    });
  };

  // única casilla que queda sin X, sin letra confirmada y sin bloquear por fila o columna.
  // si luego la ocupas, sigue marcada: el recuerdo solo se borra si vuelve a haber varias
  const greenRef = useRef(null);
  const lastFree = useMemo(() => {
    if (!reglas.ultimaLibre) return null;
    let found = null, n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = `${r}:${c}`;
        const v = cells[id];
        if (fixed[id]) continue;
        if (v && (v.x || v.conf)) continue;
        if (blocked.R[String(r)] || blocked.K[String(c)] || vecinas[id]) continue;
        n++; found = id;
        if (n > 1) { greenRef.current = null; return null; }
      }
    }
    if (n === 1) { greenRef.current = found; return found; }
    return greenRef.current; // no queda ninguna libre: la última sigue resaltada
  }, [rows, cols, cells, fixed, blocked, vecinas, reglas.ultimaLibre]);

  useEffect(() => { if (!resuelto) setCerrado(false); }, [resuelto]);

  // zonas táctiles centradas en cada frontera, para el modo Paredes
  const tiras = useMemo(() => {
    const out = [];
    const gw = 100 / cols, gh = 100 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        out.push({
          k: "v" + r + "," + c,
          left: (c + 1) * gw, top: (r + 0.5) * gh,
          w: gw * 0.26, h: gh * 0.72,
        });
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          k: "h" + r + "," + c,
          left: (c + 0.5) * gw, top: (r + 1) * gh,
          w: gw * 0.72, h: gh * 0.26,
        });
      }
    }
    return out;
  }, [rows, cols]);

  // Las paredes se dibujan en una sola capa por encima de la rejilla. Hacerlo
  // casilla a casilla dejaba sin pintar los cruces, porque cada trazo quedaba
  // por dentro del borde de su propia casilla.
  const lineasPared = useMemo(() => {
    const out = [];
    const deW = (k) => {
      const v = walls[k];
      return v ? colorPared(v === true ? "n" : v).css : null;
    };
    const hayV = (r, c) => reglas.regiones
      ? deW("v" + r + "," + c)
      : (reglas.simboloCaja && (c + 1) % reglas.cajaC === 0 ? COLORES[0].css : null);
    const hayH = (r, c) => reglas.regiones
      ? deW("h" + r + "," + c)
      : (reglas.simboloCaja && (r + 1) % reglas.cajaR === 0 ? COLORES[0].css : null);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const col = hayV(r, c);
        if (col) out.push({ k: "v" + r + "," + c, x1: c + 1, y1: r, x2: c + 1, y2: r + 1, col });
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const col = hayH(r, c);
        if (col) out.push({ k: "h" + r + "," + c, x1: c, y1: r + 1, x2: c + 1, y2: r + 1, col });
      }
    }
    return out;
  }, [walls, rows, cols, reglas]);

  // Tocar una pared del mismo color la quita; de otro color, la recolorea.
  const alternarPared = (k) => {
    applyFixed((b) => {
      const w = { ...(b.walls || {}) };
      const actual = w[k] === true ? "n" : w[k]; // partidas antiguas: true = negro
      if (!actual) w[k] = pincel;
      else if (actual === pincel) delete w[k];
      else w[k] = pincel;
      return { ...b, walls: w };
    });
  };

  const els = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `${r}:${c}`;
      const v = cells[id] || { cand: [], conf: null, x: false };
      const isFixed = !!fixed[id];
      const esPista = isFixed && !!v.conf;
      const isX = !!v.x;
      const isAuto = !isFixed && !isX && !v.conf &&
        (blocked.R[String(r)] || blocked.K[String(c)] || vecinas[id]);
      const err = !!errors.bad[id];
      const free = lastFree === id;
      const enAlcance = !v.conf && !isX && !isFixed &&
        (alcance.F[r] || alcance.K[c] || alcance.B[caja(r, c)]);

      els.push(
        <div key={id}
          onClick={() => tap(r, c)}
          onPointerDown={() => pulsarCasilla(r, c)}
          onPointerUp={soltarCasilla}
          onPointerLeave={soltarCasilla}
          onPointerCancel={soltarCasilla}
          style={{
            position: "relative",
            border: "1px solid rgba(20,25,28,0.4)",
            boxShadow: err ? "inset 0 0 0 4px " + C.ferrari : "none",
            background: err ? "rgba(255,40,0,0.22)"
              : free ? "rgba(64,170,96,0.30)"
              : isFixed ? "rgba(20,25,28,0.13)"
              : enAlcance ? "rgba(88,96,235,0.42)" : "transparent",
            touchAction: "manipulation", cursor: "pointer",
          }}>
          {(isX || isAuto || (isFixed && !esPista)) && (
            <svg viewBox="0 0 10 10" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              <path d="M1.6 1.6 L8.4 8.4 M8.4 1.6 L1.6 8.4"
                stroke={isFixed ? "rgba(20,25,28,0.85)" : "rgba(20,25,28,0.6)"}
                strokeWidth={isFixed ? 1.1 : 0.85}
                strokeLinecap="round" fill="none" />
            </svg>
          )}
          {v.conf ? (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: cell * 0.62, fontWeight: esPista ? 800 : 700,
              color: err ? C.ferrari : "#000",
              textShadow: "0 0 6px rgba(255,255,255,.95), 0 0 3px rgba(255,255,255,1)",
            }}>{v.conf}</div>
          ) : (
            <div style={{
              position: "absolute", inset: 0, display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr 1fr", padding: cell * 0.05,
            }}>
              {Array.from({ length: 9 }).map((_, i) => {
                const L = v.cand[i];
                const on = L && L === letter && !isFixed && !isX && !isAuto;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: cell * (on ? 0.34 : 0.23),
                    fontWeight: on ? 800 : 600,
                    color: on ? C.ferrari : "#000",
                    lineHeight: 1,
                    textShadow: on
                      ? "0 0 5px rgba(255,255,255,1), 0 0 3px rgba(255,255,255,1)"
                      : "0 0 4px rgba(255,255,255,.95)",
                  }}>{L || ""}</div>
                );
              })}
            </div>
          )}
        </div>
      );
    }
  }

  const capsula = {
    display: "flex", gap: 5, flexWrap: "wrap", padding: 5,
    background: C.surface, borderRadius: 15, border: "1px solid " + C.line,
  };

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      padding: 12, boxSizing: "border-box", gap: 8, maxWidth: 900, margin: "0 auto",
    }}>
      <div style={{
        flex: "0 0 auto", display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingLeft: 4 }}>
          <span style={{
            fontSize: 21, fontWeight: 800, letterSpacing: "0.05em", color: "#E8B54A",
          }}>TRAMA</span>
          <span style={{ fontSize: 17, fontWeight: 500, color: C.soft }}>Cuaderno</span>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={capsula}>
          <Btn active={mode === "fixx"} onClick={() => setMode("fixx")}>Fijar</Btn>
          {reglas.regiones && (
            <Btn onClick={() => setMode("wall")}
              style={mode === "wall" ? {
                background: colorPared(pincel).css,
                borderColor: colorPared(pincel).css,
                color: colorPared(pincel).claro ? "#15191C" : "#fff",
              } : undefined}>Paredes</Btn>
          )}
          {mode === "wall" && (
            <Btn tone="warn" onClick={() => {
              if (!Object.keys(walls).length) return;
              if (!window.confirm("¿Borrar todas las paredes del tablero?")) return;
              applyFixed((b) => ({ ...b, walls: {} }));
            }}>Borrar todas</Btn>
          )}
          <Btn onClick={clearAll} tone="warn">Vaciar</Btn>
        </div>
        <div style={capsula}>
          <Btn onClick={pantallaCompleta} style={{ padding: "9px 11px" }}>
            <span title="Pantalla completa" style={{ display: "block" }}><IconFull on={full} /></span>
          </Btn>
          <Btn onClick={onSettings} tone="warn">Inicio</Btn>
        </div>
        </div>
      </div>

      <div style={{
        flex: "0 0 auto", display: "flex", gap: 8, flexWrap: "wrap",
        alignItems: "flex-start", justifyContent: "space-between",
      }}>
        <div style={capsula}>
          <Btn active={mode === "cand"} onClick={() => setMode("cand")}>Candidatos</Btn>
          <Btn active={mode === "conf"} onClick={() => setMode("conf")}>Confirmar</Btn>
          <Btn active={mode === "erase"} onClick={() => setMode("erase")}>Borrar</Btn>
        </div>

        <div style={{ ...capsula, alignItems: "center" }}>
          <Btn onClick={undo} disabled={!canUndo} style={{ padding: "9px 11px" }}>
            <span title="Deshacer" style={{ display: "block" }}><IconUndo /></span>
          </Btn>
          <Btn onClick={redo} disabled={!canRedo} style={{ padding: "9px 11px" }}>
            <span title="Rehacer" style={{ display: "block" }}><IconRedo /></span>
          </Btn>
          <Btn onClick={marcar} active style={{ padding: "9px 11px" }}>
            <span title="Capturar el estado actual"
              style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <IconMark />
              <span style={{
                fontSize: 15, fontWeight: 700, minWidth: 22,
                textAlign: "center", fontVariantNumeric: "tabular-nums",
              }}>{snapN}</span>
            </span>
          </Btn>
          <Btn onClick={volver} disabled={!haySnap} style={{ padding: "9px 11px" }}>
            <span title="Volver a la captura" style={{ display: "block" }}><IconBack /></span>
          </Btn>
        </div>

      </div>

      {resuelto && !cerrado && (
        <div onClick={() => setCerrado(true)}
          style={{
            flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12,
            padding: "12px 16px", borderRadius: 12, cursor: "pointer",
            background: "rgba(64,170,96,0.18)", border: "1px solid #40AA60",
          }}>
          <span style={{ fontSize: 26 }}>✓</span>
          <span>
            <span style={{ display: "block", fontSize: 18, fontWeight: 700, color: "#8FE0A8" }}>
              Resuelto
            </span>
            <span style={{ fontSize: 14, color: C.soft }}>
              Todo cuadra con las reglas activas. Toque para cerrar el aviso.
            </span>
          </span>
        </div>
      )}

      {(errors.count > 0 || errors.names.length > 0) && (
        <p style={{
          flex: "0 0 auto", margin: 0, padding: "8px 12px", borderRadius: 10,
          background: "rgba(255,40,0,0.16)", border: "1px solid " + C.ferrari,
          color: "#FFB3A2", fontSize: 15, fontWeight: 500,
        }}>
          {errors.count > 0
            ? errors.count + (errors.count === 1 ? " casilla en conflicto: " : " casillas en conflicto: ")
            : "Solución incorrecta: "}
          {errors.names.join(", ")}.
        </p>
      )}

      {mode === "fixx" && (
        <p style={{
          flex: "0 0 auto", margin: 0, padding: "8px 12px", borderRadius: 10,
          background: C.surface, border: "1px solid " + C.line,
          color: C.soft, fontSize: 14, lineHeight: 1.45,
        }}>
          Elija un símbolo y toque una casilla para fijarlo en ella.
        </p>
      )}

      {mode === "wall" ? (
        <div style={{ flex: "0 0 auto", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {COLORES.map((c) => (
            <button key={c.id} onClick={() => setPincel(c.id)} title={c.nombre}
              style={{
                width: FICHA, height: FICHA, borderRadius: 13,
                border: "1px solid " + (pincel === c.id ? C.accent : C.line),
                boxShadow: pincel === c.id ? "0 0 0 3px rgba(111,118,242,0.40)" : "none",
                background: c.css, cursor: "pointer", touchAction: "manipulation",
              }} />
          ))}
        </div>
      ) : (
      <div ref={letrasRef} style={{ flex: "0 0 auto" }}>
        {filas.map((fila, fi) => (
          <div key={fi} style={{
            display: "flex", gap: 6, justifyContent: "center",
            marginBottom: fi < filas.length - 1 ? 6 : 0,
          }}>
            {fila.map((L) => {
              if (L === "\u00d7") {
                const xActiva = mode === "fixx" && fijarVacio;
                return (
                  <button key="__x"
                    onClick={() => setFijarVacio(true)}
                    title="Fijar casilla imposible"
                    style={{
                      width: FICHA, height: FICHA, borderRadius: 13, fontSize: 20, fontWeight: 700,
                      border: "1px solid " + (xActiva ? C.accent : C.line),
                      boxShadow: xActiva ? "0 0 0 3px rgba(111,118,242,0.40)" : "none",
                      background: xActiva ? C.accent : C.panel,
                      color: xActiva ? C.accentInk : C.ink,
                      touchAction: "manipulation", cursor: "pointer",
                    }}>X</button>
                );
              }
              // el rojo de "ya colocado" es información de partida, no de la fase de fijar
              const done = !!confirmedLetters[L] && mode !== "fixx";
              const anotado = !done && !!conCandidatos[L];
              const off = mode === "erase";
              // solo puede haber una ficha resaltada: la letra elegida o la X
              const sel = letter === L && !off && !(mode === "fixx" && fijarVacio);
              return (
                <button key={L}
              onClick={() => { setLetter(L); setFijarVacio(false); }}
                  style={{
                    width: FICHA, height: FICHA, borderRadius: 13, fontSize: 20, fontWeight: 700,
                    border: "1px solid " + (sel ? C.accent : done ? C.ferrari : anotado ? "#8B95A0" : C.line),
                    boxShadow: sel ? "0 0 0 3px rgba(111,118,242,0.40)" : "none",
                    background: done ? C.ferrari : sel ? C.accent : anotado ? "#6E7A86" : C.panel,
                    color: done || anotado ? "#fff" : sel ? C.accentInk : C.ink,
                    opacity: off ? 0.3 : 1,
                    touchAction: "manipulation", cursor: "pointer",
                  }}>{L}</button>
              );
            })}
          </div>
        ))}
      </div>
      )}

      {mode === "wall" && (
        <p style={{
          flex: "0 0 auto", margin: 0, padding: "8px 12px", borderRadius: 10,
          background: C.surface, border: "1px solid " + C.line,
          color: C.soft, fontSize: 14, lineHeight: 1.45,
        }}>
          Toque entre dos casillas para poner una pared del color elegido. Tocar una del
          mismo color la quita; de otro color, la recolorea. Regiones: {nReg}.
          {reglas.ocupacionUnica && nReg !== rows
            ? " Ojo: en este tipo de pasatiempo suele haber tantas regiones como filas (" + rows + ")."
            : ""}
        </p>
      )}

      <div ref={areaRef} style={{
        flex: "1 1 auto", minHeight: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <div ref={wrapRef} style={{
          position: "relative", width: tam.w || "100%", height: tam.h || undefined,
          aspectRatio: tam.w ? undefined : `${cols} / ${rows}`,
          borderRadius: 10, overflow: "hidden", background: "#fff",
          boxShadow: "0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(111,118,242,0.45)",
        }}>
          {img && <img src={img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
          <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: dim, pointerEvents: "none" }} />
          <div style={{
            position: "absolute", inset: 0, display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}>{els}</div>

          <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none"
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              pointerEvents: "none",
            }}>
            {lineasPared.map((l) => (
              <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke={l.col} strokeWidth="6"
                strokeLinecap="square" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>

          {mode === "wall" && (
            <div style={{ position: "absolute", inset: 0 }}>
              {tiras.map((t) => (
                <div key={t.k} onClick={() => alternarPared(t.k)}
                  style={{
                    position: "absolute",
                    left: t.left + "%", top: t.top + "%",
                    width: t.w + "%", height: t.h + "%",
                    transform: "translate(-50%, -50%)",
                    cursor: "pointer", touchAction: "manipulation",
                  }} />
              ))}
            </div>
          )}

        </div>
      </div>

      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 15, color: C.soft, whiteSpace: "nowrap" }}>Atenuar mapa</span>
        <input type="range" min="0" max="0.8" step="0.05" value={dim}
          onChange={(ev) => setDim(Number(ev.target.value))}
          style={{ flex: 1, minWidth: 120, accentColor: C.accent }} />
      </div>
    </div>
  );
}

// Dentro de la app de Android, el menú de compartir de la web no existe: hay
// que pasar por los plugins nativos. Fuera, en el navegador, se usa el de la web.
function enApp() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
    && window.Capacitor.isNativePlatform());
}

function aBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

// Los plugins los expone main.jsx al arrancar; si no, se busca en el puente nativo.
function plugins() {
  if (window.__cap && window.__cap.Filesystem && window.__cap.Share) return window.__cap;
  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  if (P.Filesystem && P.Share) return P;
  return null;
}

// Devuelve true si ha conseguido compartir; false si hay que recurrir a la descarga.
async function compartir(fichero, base64, titulo) {
  if (!enApp()) return false;
  const P = plugins();
  if (!P) throw new Error("plugins no disponibles");
  await P.Filesystem.writeFile({ path: fichero, data: base64, directory: "CACHE" });
  const r = await P.Filesystem.getUri({ path: fichero, directory: "CACHE" });
  await P.Share.share({ title: titulo, files: [r.uri] });
  return true;
}

// cancelar el menú de compartir no es un fallo, es una decisión del usuario
function cancelado(e) {
  if (!e) return false;
  if (e.name === "AbortError") return true;
  return /cancel/i.test(e.message || String(e));
}

// texto corto de diagnóstico, para saber por qué ha fallado
function porQue(e) {
  if (!e) return "motivo desconocido";
  return (e.message || String(e)).slice(0, 120);
}

// Las celdas fijas quedan al margen del historial: al restaurar un estado
// anterior se conserva lo que tengan ahora, sea un símbolo o una X.
function conFijas(nuevas, actuales, fixed) {
  const out = { ...nuevas };
  Object.keys(fixed).forEach((id) => {
    if (actuales[id]) out[id] = actuales[id]; else delete out[id];
  });
  return out;
}

// Tamaños de sudoku donde la caja es inequívoca. En un 6x6 podría ser 3x2 o
// 2x3, así que ahí no se inventa nada.
const CAJAS_CLARAS = { 9: { r: 3, c: 3 }, 4: { r: 2, c: 2 } };

function paredesDeCaja(rows, cols) {
  if (rows !== cols) return null;
  const caja = CAJAS_CLARAS[rows];
  if (!caja) return null;
  const w = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if ((c + 1) % caja.c === 0) w["v" + r + "," + c] = "n";
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + 1) % caja.r === 0) w["h" + r + "," + c] = "n";
    }
  }
  return w;
}

/* ---------- app ---------- */
export default function App() {
  const [step, setStep] = useState("setup");
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(6);
  const [palette, setPalette] = useState(["A", "B", "C", "D", "E", "V"]);
  const [reglas, setReglas] = useState(REGLAS.murdoku);
  const [preset, setPreset] = useState("murdoku");
  const [srcImg, setSrcImg] = useState(null);
  const [corners, setCorners] = useState([
    { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 },
  ]);
  const [warped, setWarped] = useState(null);
  const [usedImg, setUsedImg] = useState(null); // foto con la que se generó el mapa actual
  const [board, setBoard] = useState({ cells: {}, fixed: {}, walls: {} });
  const [hist, setHist] = useState([]);
  const [future, setFuture] = useState([]);
  const [snap, setSnap] = useState({}); // captura rápida de las anotaciones, solo en memoria
  const [snapN, setSnapN] = useState(0);
  const [mode, setMode] = useState("cand");
  const [letter, setLetter] = useState("A");
  const [dim, setDim] = useState(0.3);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (palette.length && palette.indexOf(letter) < 0) setLetter(palette[0]);
  }, [palette, letter]);

  useEffect(() => {
    if (mode === "wall" && !reglas.regiones) setMode("cand");
  }, [reglas, mode]);

  /* cargar sesión guardada */
  useEffect(() => {
    (async () => {
      try {
        let r = await store.get(KEY);
        if (!r || !r.value) r = await store.get(KEY_VIEJA);
        if (r && r.value) {
          const s = JSON.parse(r.value);
          setRows(s.rows); setCols(s.cols);
          if (Array.isArray(s.palette)) setPalette(s.palette);
          if (s.reglas) setReglas({ ...REGLAS.murdoku, ...s.reglas });
          if (s.preset) setPreset(s.preset);
          setWarped(s.warped || null);
          if (s.srcImg) {
            setSrcImg(s.srcImg);
            setUsedImg(s.used ? s.srcImg : null);
          }
          if (Array.isArray(s.corners) && s.corners.length === 4) setCorners(s.corners);
          setBoard({
            cells: (s.board && s.board.cells) || s.cells || {},
            fixed: (s.board && s.board.fixed) || {},
            walls: (s.board && s.board.walls) || {},
          });
          if (typeof s.dim === "number") setDim(s.dim);
          setStep("board");
        }
      } catch (e) { /* sin sesión previa */ }
      setLoaded(true);
    })();
  }, []);

  /* autoguardado */
  useEffect(() => {
    if (!loaded || step !== "board") return;
    const t = setTimeout(() => {
      const base = { rows, cols, palette, reglas, preset, warped, board, dim, corners };
      const full = { ...base, srcImg, used: !!srcImg && srcImg === usedImg };
      store.set(KEY, JSON.stringify(full)).catch(() => {
        // si no cabe la foto original, al menos que se guarde la partida
        store.set(KEY, JSON.stringify(base)).catch(() => {});
      });
    }, 600);
    return () => clearTimeout(t);
  }, [loaded, step, rows, cols, palette, reglas, preset, warped, board, dim, corners, srcImg, usedImg]);

  const apply = useCallback((fn) => {
    setBoard((prev) => {
      const next = fn(prev);
      if (next === prev) return prev;
      setHist((h) => [...h.slice(-99), prev.cells]); // solo las anotaciones
      setFuture([]); // una jugada nueva corta la rama de rehacer
      setSnapN((n) => n + 1);
      return next;
    });
  }, []);

  // cambios que no entran en el historial: las X fijas son inamovibles
  const applyFixed = useCallback((fn) => {
    setBoard((prev) => fn(prev));
  }, []);

  const undo = () => {
    setHist((h) => {
      if (!h.length) return h;
      setBoard((b) => {
        setFuture((f) => [...f.slice(-99), b.cells]);
        return { ...b, cells: conFijas(h[h.length - 1], b.cells, b.fixed) };
      });
      setSnapN((n) => n + 1);
      return h.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      setBoard((b) => {
        setHist((h) => [...h.slice(-99), b.cells]);
        return { ...b, cells: conFijas(f[f.length - 1], b.cells, b.fixed) };
      });
      setSnapN((n) => n + 1);
      return f.slice(0, -1);
    });
  };

  const clearAll = () => {
    const empty = !Object.keys(board.cells).length;
    if (!empty && !window.confirm("¿Vaciar las anotaciones? Se perderá también el historial de Deshacer.")) return;
    setBoard((b) => ({ ...b, cells: conFijas({}, b.cells, b.fixed) }));
    setSnap({});
    setHist([]); setFuture([]);
    setSnapN(0);
  };


  const marcar = () => { setSnap(board.cells); setSnapN(0); };

  const volver = () => {
    if (!snap) return;
    if (!window.confirm("Se descartan los " + snapN + (snapN === 1 ? " cambio hecho" : " cambios hechos") +
      " desde la captura y el tablero vuelve a ese punto. ¿Continuar?")) return;
    setHist((h) => [...h.slice(-99), board.cells]); // la vuelta atrás también se puede deshacer
    setFuture([]);
    setBoard((b) => ({ ...b, cells: conFijas(snap, b.cells, b.fixed) }));
    setSnapN(0);
  };

  /* ---------- partidas en archivo ---------- */
  // el paquete lleva absolutamente todo: así el navegador no necesita recordar nada
  const paquete = useCallback((name) => ({
    app: "trama", v: 3, name, t: Date.now(),
    rows, cols, palette, reglas, preset, dim,
    srcImg, corners, warped, usedIgual: !!srcImg && srcImg === usedImg,
    board, hist, future,
  }), [rows, cols, palette, reglas, preset, dim, srcImg, corners, warped, usedImg, board, hist, future]);

  // Guardar por el menú del sistema: así elige usted el destino. Dentro de la
  // app de Android una descarga normal acaba en una carpeta privada difícil
  // de encontrar después.
  const guardarArchivo = async (nombre) => {
    setAviso("");
    // el prefijo delata el pasatiempo de un vistazo en la carpeta
    const PREFIJO = {
      murdoku: "trm_murd", sudoku: "trm_sud",
      star: "trm_star", libre: "trm_pers",
    };
    const name = (nombre || "").trim();
    // se conservan tildes y eñes: los nombres de archivo los admiten
    const limpio = name.replace(/[^\wÁÉÍÓÚÜÑáéíóúüñ\-]+/g, "_").slice(0, 40);
    const pref = PREFIJO[preset] || "trm";
    const fichero = pref + (limpio ? "_" + limpio : "") + ".json";

    let datos;
    try {
      datos = JSON.stringify(paquete(name || pref));
    } catch (e) {
      setAviso("No se ha podido generar el archivo.");
      return;
    }

    const blob = new Blob([datos], { type: "application/json" });

    try {
      if (await compartir(fichero, aBase64(datos), name || fichero)) {
        setAviso("Partida guardada donde la haya enviado.");
        return;
      }
      const file = new File([blob], fichero, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        setAviso("Partida guardada donde la haya enviado.");
        return;
      }
    } catch (e) {
      if (cancelado(e)) return;
      setAviso("No se pudo abrir el menú de compartir (" + porQue(e) + "). Se descarga el archivo.");
    }

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fichero;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setAviso("Partida descargada como " + fichero + ".");
    } catch (e) {
      setAviso("No se ha podido generar el archivo.");
    }
  };

  const abrirArchivo = (file) => {
    setAviso("");
    const hay = Object.keys(board.cells).length || Object.keys(board.fixed).length;
    if (hay && !window.confirm("Se sustituirá la partida abierta. Si no se ha guardado en un archivo, se perderá. ¿Continuar?")) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const s = JSON.parse(String(fr.result));
        if (!s || !s.rows || !s.cols) throw new Error("formato");
        setRows(s.rows); setCols(s.cols);
        if (Array.isArray(s.palette)) setPalette(s.palette);
        if (s.reglas) setReglas({ ...REGLAS.murdoku, ...s.reglas });
        if (s.preset) setPreset(s.preset);
        if (typeof s.dim === "number") setDim(s.dim);
        setWarped(s.warped || null);
        setSrcImg(s.srcImg || null);
        setUsedImg(s.usedIgual ? (s.srcImg || null) : null);
        if (Array.isArray(s.corners) && s.corners.length === 4) setCorners(s.corners);
        const cargado = {
          cells: (s.board && s.board.cells) || {},
          fixed: (s.board && s.board.fixed) || {},
          walls: (s.board && s.board.walls) || {},
        };
        setBoard(cargado);
        // los archivos antiguos guardaban el tablero entero en el historial
        const soloCeldas = (a) => (Array.isArray(a) ? a.map((x) => (x && x.cells ? x.cells : x || {})) : []);
        setHist(soloCeldas(s.hist));
        setFuture(soloCeldas(s.future));
        setSnap(cargado.cells); setSnapN(0); // la captura arranca en el punto que traía el archivo
        setMode("cand");
        setStep("board");
      } catch (e) {
        setAviso("El archivo no parece una partida de Trama.");
      }
    };
    fr.onerror = () => setAviso("No se ha podido leer el archivo.");
    fr.readAsText(file);
  };

  // las pistas leídas entran como celdas fijas, fuera del historial
  const aplicarLectura = (mapa) => {
    let conFallo = false;
    setBoard((b) => {
      const nc = { ...b.cells }, nf = { ...b.fixed };
      Object.entries(mapa).forEach(([id, sim]) => {
        nc[id] = { cand: [], conf: sim, x: false };
        nf[id] = true;
      });
      // si la lectura ha dejado contradicciones, hay que corregirlas antes de jugar
      conFallo = calcularErrores(nc, { ...reglas, errores: true }).count > 0;
      return { ...b, cells: nc, fixed: nf };
    });
    setHist([]); setFuture([]); setSnapN(0);
    setSnap({});
    setMode(conFallo ? "fixx" : "cand");
    setStep("board");
  };

  // guardar el mapa ya enderezado: compartir si el sistema lo permite
  // (así se puede mandar a la galería), y si no, descarga normal
  const guardarImagen = async () => {
    if (!warped) return;
    setAvisoReg("");
    const nombre = "trama_mapa_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "") + ".jpg";
    try {
      const coma = warped.indexOf(",");
      if (await compartir(nombre, warped.slice(coma + 1), "Trama")) return;
      const blob = await (await fetch(warped)).blob();
      const file = new File([blob], nombre, { type: "image/jpeg" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Trama" });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      if (cancelado(e)) return;
      setAvisoReg("No se pudo guardar la imagen: " + porQue(e));
      try {
        const a = document.createElement("a");
        a.href = warped; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e2) { /* nada más que hacer */ }
    }
  };

  const [avisoReg, setAvisoReg] = useState("");

  const detectarRegiones = () => {
    if (!warped) return;
    setAvisoReg("Analizando…");
    const im = new Image();
    im.onload = () => {
      try {
        const { medidas, corte } = detectarParedes(im, rows, cols);
        const w = {};
        medidas.forEach((m) => { if (m.g >= corte) w[m.k] = true; });
        setBoard((b) => ({ ...b, walls: w }));
        const { n } = regionesDe(w, rows, cols);
        setAvisoReg(n + (n === 1 ? " región encontrada" : " regiones encontradas") +
          ". Repáselas en el tablero y corrija las paredes que falten.");
      } catch (e) { setAvisoReg("No se han podido detectar las regiones."); }
    };
    im.onerror = () => setAvisoReg("No se ha podido leer la imagen.");
    im.src = warped;
  };

  // rejilla limpia, sin fotografía debajo
  const sinFoto = () => {
    const hay = Object.keys(board.cells).length || Object.keys(board.fixed).length;
    if ((warped || hay) &&
      !window.confirm("Se abrirá una rejilla en blanco y se descartará la imagen y las anotaciones actuales. ¿Continuar?")) return;
    setWarped(null); setSrcImg(null); setUsedImg(null);
    setBoard({ cells: {}, fixed: {}, walls: {} });
    setHist([]); setFuture([]); setSnap({}); setSnapN(0);
    setMode("cand");
    setAvisoReg("");
    setStep("board");
  };

  const aplicarPreset = (k) => {
    setPreset(k);
    if (k === "libre") return;
    const pr = PRESETS[k];
    const reg = { ...REGLAS[k] };
    setRows(pr.rows); setCols(pr.cols); setPalette(pr.palette);

    // en sudoku las cajas pasan a ser paredes normales, editables como las demás
    if (k === "sudoku") {
      const w = paredesDeCaja(pr.rows, pr.cols);
      if (w) {
        reg.regiones = true;
        const hay = Object.keys(board.walls || {}).length;
        if (!hay || window.confirm("Se sustituirán las paredes actuales por las cajas del sudoku. ¿Continuar?")) {
          setBoard((b) => ({ ...b, walls: w }));
        }
      }
    }
    setReglas(reg);
  };

  // al fijar un tamaño inequívoco sin paredes puestas, se dibujan las cajas solas
  useEffect(() => {
    if (!reglas.regiones) return;
    if (Object.keys(board.walls || {}).length) return;
    const w = paredesDeCaja(rows, cols);
    if (w) setBoard((b) => ({ ...b, walls: w }));
  }, [rows, cols, reglas.regiones]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPhoto = (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const small = await shrink(String(fr.result), MAX_IMPORT);
      setSrcImg(small);
      setCorners([
        { x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 },
      ]);
    };
    fr.readAsDataURL(f);
    ev.target.value = "";
  };

  const doWarp = (imgEl) => {
    // foto distinta a la del mapa actual: es otro caso, así que el cuaderno se vacía
    const nueva = srcImg !== usedImg;
    const conNotas = Object.keys(board.cells).length > 0 || Object.keys(board.fixed).length > 0;
    if (nueva && conNotas &&
      !window.confirm("La fotografía es distinta, por lo que se inicia un caso nuevo. Se borrarán las anotaciones y las celdas fijas del anterior. ¿Continuar?")) return;

    setBusy(true);
    setTimeout(() => {
      const cellPx = Math.min(150, Math.floor(1400 / Math.max(rows, cols)));
      setWarped(warp(imgEl, corners, cols * cellPx, rows * cellPx));
      setUsedImg(srcImg);
      if (nueva) {
        setBoard({ cells: {}, fixed: {}, walls: {} });
        setHist([]); setFuture([]);
        setSnap({}); setSnapN(0);
        // solo se arranca fijando donde hay casillas imposibles que marcar
        setMode(!reglas.regiones && reglas.tachado ? "fixx" : "cand");
      }
      setBusy(false);
      // enderezar es un paso de preparación: se vuelve a ajustes
      setStep("setup");
    }, 30);
  };

  if (!loaded) return <div style={{ padding: 24, fontFamily: "system-ui" }}>Abriendo el cuaderno…</div>;

  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: C.ink,
      fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      WebkitTapHighlightColor: "transparent",
    }}>
      {step === "setup" && (
        <Setup
          rows={rows} cols={cols} palette={palette} reglas={reglas} preset={preset}
          hasImg={!!srcImg} hayMapa={!!warped} onPreset={aplicarPreset}
          onChange={(p) => {
            if (p.rows !== undefined) setRows(p.rows);
            if (p.cols !== undefined) setCols(p.cols);
            if (p.palette !== undefined) setPalette(p.palette);
            if (p.reglas !== undefined) { setReglas(p.reglas); setPreset("libre"); }
          }}
          onPhoto={onPhoto}
          onSaves={() => setStep("saves")}
          onHelp={() => setStep("help")}
          onLeer={() => setStep("leer")}
          onGuardarImagen={guardarImagen}
          onDetectarRegiones={detectarRegiones} avisoReg={avisoReg}
          onSinFoto={sinFoto}
          onStart={() => setStep(srcImg ? "crop" : "board")}
          onBoard={() => setStep("board")}
        />
      )}

      {step === "crop" && srcImg && (
        <Crop src={srcImg} corners={corners} setCorners={setCorners} busy={busy}
          onBack={() => setStep("setup")} onDone={doWarp} />
      )}

      {step === "help" && <Help onBack={() => setStep("setup")} />}

      {step === "leer" && (
        <Leer
          img={warped} rows={rows} cols={cols} palette={palette}
          onBack={() => setStep(warped ? "board" : "setup")}
          onAplicar={aplicarLectura}
        />
      )}

      {step === "saves" && (
        <Saves
          aviso={aviso}
          tieneNotas={!!(Object.keys(board.cells).length || Object.keys(board.fixed).length
            || Object.keys(board.walls || {}).length || warped)}
          onSave={guardarArchivo} onOpen={abrirArchivo} hayMapa={!!warped}
          onBack={() => { setAviso(""); setStep("setup"); }}
          onTablero={() => { setAviso(""); setStep("board"); }}
        />
      )}

      {step === "board" && (
        <Board
          rows={rows} cols={cols} palette={palette} reglas={reglas} img={warped}
          board={board} apply={apply} applyFixed={applyFixed}
          mode={mode} setMode={setMode}
          letter={letter} setLetter={setLetter}
          dim={dim} setDim={setDim}
          undo={undo} canUndo={hist.length > 0}
          redo={redo} canRedo={future.length > 0}
          marcar={marcar} volver={volver} snapN={snapN} haySnap={!!snap && snapN > 0}
          clearAll={clearAll}
          onSettings={() => setStep("setup")}
        />
      )}
    </div>
  );
}
