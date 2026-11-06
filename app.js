const estado = { lider: null, depto: null, muni: null, zona: null, puesto: null };
let datos, mapa, popup;

const COLORES = ["#006837", "#1a9850", "#66bd63", "#a6d96a", "#d9ef8b", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026"];

function miles(n) {
  return Number(n || 0).toLocaleString("es-CO");
}

function decimal(n) {
  if (n == null || Number.isNaN(n)) return "";
  return Number(n).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function texto(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function color(valor, max) {
  if (!max || !valor) return "#e8eef2";
  const i = Math.min(COLORES.length - 1, Math.floor((valor / max) * (COLORES.length - 1)));
  return COLORES[i];
}

function boundsDe(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rec = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1]);
      maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1]);
      return;
    }
    c.forEach(rec);
  };
  rec(geom.coordinates);
  return [[minX, minY], [maxX, maxY]];
}

function encajar(features, padding) {
  if (!features.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  features.forEach((ft) => {
    const b = boundsDe(ft.geometry);
    minX = Math.min(minX, b[0][0]); minY = Math.min(minY, b[0][1]);
    maxX = Math.max(maxX, b[1][0]); maxY = Math.max(maxY, b[1][1]);
  });
  mapa.fitBounds([[minX, minY], [maxX, maxY]], { padding: padding || 32, duration: 500 });
}

async function cargar() {
  const [heat, pais, muni, cali] = await Promise.all([
    fetch("data/heatmap.json").then((r) => r.json()),
    fetch("data/colombia.geo.json").then((r) => r.json()),
    fetch("data/colombia_municipios.geo.json").then((r) => r.json()),
    fetch("data/cali_zonas.geojson").then((r) => r.json()),
  ]);
  const porDepto = Object.fromEntries(heat.departamentos.map((d) => [d.id, d.personas]));
  const maxDepto = Math.max(...heat.departamentos.map((d) => d.personas));
  pais.features.forEach((ft) => {
    const id = ft.properties.NOMBRE_DPT;
    const personas = porDepto[id] || 0;
    ft.properties.personas = personas;
    ft.properties.color = color(personas, maxDepto);
  });
  datos = { heat, pais, muni, cali, porDepto, corte: new Map(), liderPintado: undefined };
  const pedido = new URL(location.href).searchParams.get("lider");
  estado.lider = (heat.lideres || []).some((l) => l.id === pedido) ? pedido : null;
  activarCorte();
  aplicarHash();
  iniciarMapa();
  window.addEventListener("hashchange", aplicarHash);
}

function iniciarMapa() {
  mapa = new maplibregl.Map({
    container: "mapa",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [-74.3, 4.6],
    zoom: 4.4,
    attributionControl: true,
  });
  mapa.addControl(new maplibregl.NavigationControl(), "top-right");
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  mapa.on("load", () => {
    mapa.addSource("pais", { type: "geojson", data: datos.pais });
    mapa.addSource("muni", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    mapa.addSource("zonas", { type: "geojson", data: datos.cali });
    mapa.addSource("puntos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    mapa.addLayer({
      id: "pais-relleno", type: "fill", source: "pais",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 },
    });
    mapa.addLayer({
      id: "pais-linea", type: "line", source: "pais",
      paint: { "line-color": "#ffffff", "line-width": 1 },
    });
    mapa.addLayer({
      id: "muni-relleno", type: "fill", source: "muni",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 },
      layout: { visibility: "none" },
    });
    mapa.addLayer({
      id: "muni-linea", type: "line", source: "muni",
      paint: {
        "line-color": ["case", ["==", ["get", "sel"], 1], "#102018", "#ffffff"],
        "line-width": ["case", ["==", ["get", "sel"], 1], 2.4, 0.8],
      },
      layout: { visibility: "none" },
    });
    mapa.addLayer({
      id: "zona-relleno", type: "fill", source: "zonas",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.45 },
      layout: { visibility: "none" },
    });
    mapa.addLayer({
      id: "zona-linea", type: "line", source: "zonas",
      paint: {
        "line-color": ["case", ["==", ["get", "sel"], 1], "#102018", "#ffffff"],
        "line-width": ["case", ["==", ["get", "sel"], 1], 2.4, 1],
      },
      layout: { visibility: "none" },
    });
    mapa.addLayer({
      id: "puntos", type: "circle", source: "puntos",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "personas"], 1, 4, 50, 8, 400, 16],
        "circle-color": "#1c2430",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.9,
      },
      layout: { visibility: "none" },
    });
    enlazar("pais-relleno", "NOMBRE_DPT", "departamento");
    enlazar("muni-relleno", "MPIO_CNMBR", "municipio");
    enlazar("zona-relleno", "zona_id", "zona");
    mapa.on("click", "puntos", (ev) => {
      const p = ev.features[0].properties;
      estado.puesto = p.puesto;
      mostrarTabla();
    });
    mapa.on("mousemove", "puntos", (ev) => {
      const p = ev.features[0].properties;
      popup.setLngLat(ev.lngLat).setHTML(`<b>${texto(p.puesto)}</b><br>${miles(p.personas)} personas`).addTo(mapa);
    });
    mapa.on("mouseleave", "puntos", () => popup.remove());
    dibujar();
  });
}

function enlazar(capa, campo, tipo) {
  mapa.on("click", capa, (ev) => {
    const valor = ev.features[0].properties[campo];
    if (tipo === "departamento") elegirDepto(valor);
    else if (tipo === "municipio") elegirMuni(valor);
    else elegirZona(valor);
  });
  mapa.on("mousemove", capa, (ev) => {
    mapa.getCanvas().style.cursor = "pointer";
    const p = ev.features[0].properties;
    const nombre = p.nombre || p.NOMBRE_DPT || p.MPIO_CNMBR || "";
    popup.setLngLat(ev.lngLat).setHTML(`<b>${texto(nombre)}</b><br>${miles(p.personas)} personas`).addTo(mapa);
  });
  mapa.on("mouseleave", capa, () => {
    mapa.getCanvas().style.cursor = "";
    popup.remove();
  });
}

function dptoCnmbr(depto) {
  const mapaNombres = {
    "SANTAFE DE BOGOTA D.C": "BOGOTÁ, D.C.",
    ATLANTICO: "ATLÁNTICO", BOLIVAR: "BOLÍVAR", BOYACA: "BOYACÁ",
    CAQUETA: "CAQUETÁ", CHOCO: "CHOCÓ", CORDOBA: "CÓRDOBA",
  };
  return mapaNombres[depto] || depto;
}

function municipiosDelDepto() {
  const clave = dptoCnmbr(estado.depto);
  return datos.muni.features.filter((ft) => ft.properties.DPTO_CNMBR === clave);
}

function activarCorte() {
  const corte = new Map();
  const filas = estado.lider && datos.heat.cortes ? datos.heat.cortes[estado.lider] : null;
  if (filas) {
    filas.forEach(([i, personas, mesas]) => corte.set(i, [personas, mesas]));
  }
  datos.corte = corte;
}

function conteo(i) {
  if (!estado.lider) {
    const p = datos.heat.puestos[i];
    return [p.personas, p.mesas];
  }
  return datos.corte.get(i) || [0, 0];
}

function departamentosVista() {
  const acc = new Map();
  datos.heat.puestos.forEach((p, i) => {
    const personas = conteo(i)[0];
    if (personas) acc.set(p.depto, (acc.get(p.depto) || 0) + personas);
  });
  return [...acc.entries()]
    .map(([id, personas]) => ({ id, personas }))
    .sort((a, b) => b.personas - a.personas);
}

function puestosVisibles() {
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  const out = [];
  datos.heat.puestos.forEach((p, i) => {
    const [personas, mesas] = conteo(i);
    if (!personas) return;
    if (estado.depto && p.depto !== estado.depto) return;
    if (estado.muni && p.municipio !== estado.muni && p.municipio_geo !== estado.muni) return;
    if (estado.zona && p.zona_id !== estado.zona) return;
    if (q && !`${p.puesto} ${p.direccion} ${p.comuna}`.toLowerCase().includes(q)) return;
    out.push({ ...p, personas, mesas, i });
  });
  return out;
}

function esCali() {
  return normLocal(estado.muni) === "CALI";
}

function normLocal(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function elegirDepto(id) {
  estado.depto = id;
  estado.muni = null;
  estado.zona = null;
  estado.puesto = null;
  syncHash();
  dibujar();
}

function elegirMuni(geo) {
  const item = datos.heat.municipios.find((m) => m.depto === estado.depto && (m.geo === geo || m.nombre === geo));
  estado.muni = item ? item.nombre : geo;
  estado.zona = null;
  estado.puesto = null;
  syncHash();
  dibujar();
}

function elegirZona(id) {
  estado.zona = estado.zona === id ? null : id;
  estado.puesto = null;
  syncHash();
  dibujar();
}

function syncHash() {
  const partes = [estado.depto, estado.muni, estado.zona].filter(Boolean).map(encodeURIComponent);
  const hash = partes.length ? "#/" + partes.join("/") : "";
  const url = new URL(location.href);
  if (estado.lider) url.searchParams.set("lider", estado.lider);
  else url.searchParams.delete("lider");
  const next = url.pathname + url.search + hash;
  if (location.pathname + location.search + location.hash !== next) {
    history.replaceState(null, "", next);
  }
}

function aplicarHash() {
  const partes = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  estado.depto = partes[0] || null;
  estado.muni = partes[1] || null;
  estado.zona = partes[2] || null;
  if (mapa && mapa.getSource("muni")) dibujar();
}

function pintarControles() {
  const selL = document.getElementById("sel-lider");
  const selD = document.getElementById("sel-depto");
  const selM = document.getElementById("sel-muni");
  const selZ = document.getElementById("sel-zona");
  selL.innerHTML = `<option value="">Todos</option>` + (datos.heat.lideres || [])
    .map((l) => `<option value="${texto(l.id)}">${texto(l.nombre)} (${miles(l.personas)})</option>`).join("");
  selL.value = estado.lider || "";
  let deps = departamentosVista();
  if (estado.depto && !deps.some((d) => d.id === estado.depto)) {
    deps = [{ id: estado.depto, personas: 0 }, ...deps];
  }
  selD.innerHTML = `<option value="">Colombia</option>` + deps
    .map((d) => `<option value="${texto(d.id)}">${texto(d.id)} (${miles(d.personas)})</option>`).join("");
  const munisAcc = new Map();
  datos.heat.puestos.forEach((p, i) => {
    if (estado.depto && p.depto !== estado.depto) return;
    const personas = conteo(i)[0];
    if (!personas && p.municipio !== estado.muni) return;
    const prev = munisAcc.get(p.municipio) || 0;
    munisAcc.set(p.municipio, prev + personas);
  });
  const munis = [...munisAcc.entries()].sort((a, b) => b[1] - a[1]);
  selM.innerHTML = `<option value="">Todos</option>` + munis
    .map(([nombre, personas]) => `<option value="${texto(nombre)}">${texto(nombre)} (${miles(personas)})</option>`).join("");
  selM.disabled = !estado.depto;
  const zonas = {};
  if (esCali()) {
    datos.heat.puestos.forEach((p, i) => {
      if (normLocal(p.municipio) !== "CALI" || !p.zona_id) return;
      const personas = conteo(i)[0];
      if (!personas && p.zona_id !== estado.zona) return;
      zonas[p.zona_id] = (zonas[p.zona_id] || 0) + personas;
    });
  }
  const ids = Object.keys(zonas).sort();
  document.getElementById("lbl-zona").hidden = !esCali();
  selZ.innerHTML = `<option value="">Toda Cali</option>` + ids
    .map((id) => `<option value="${id}">${nombreZona(id)} (${miles(zonas[id])})</option>`).join("");
  selD.value = estado.depto || "";
  selM.value = estado.muni || "";
  selZ.value = estado.zona || "";
}

function pintarPais() {
  const cuentas = {};
  departamentosVista().forEach((d) => { cuentas[d.id] = d.personas; });
  const valores = Object.values(cuentas);
  const max = Math.max(1, ...(valores.length ? valores : [0]));
  datos.pais.features.forEach((ft) => {
    const personas = cuentas[ft.properties.NOMBRE_DPT] || 0;
    ft.properties.personas = personas;
    ft.properties.color = color(personas, max);
  });
  mapa.getSource("pais").setData(datos.pais);
  datos.liderPintado = estado.lider || "";
}

function nombreZona(id) {
  if (!id) return "";
  if (id.startsWith("COMUNA-")) return `Comuna ${Number(id.split("-")[1])}`;
  return id.replace("CORR-", "").replaceAll("-", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function dibujar() {
  pintarControles();
  pintarMigas();
  mostrarTabla();
  if (!mapa.getSource("muni")) return;
  if (datos.liderPintado !== (estado.lider || "")) pintarPais();

  const verPais = !estado.depto;
  const verCali = esCali();
  mapa.setLayoutProperty("pais-relleno", "visibility", verPais ? "visible" : "none");
  mapa.setLayoutProperty("pais-linea", "visibility", verPais ? "visible" : "none");
  mapa.setLayoutProperty("muni-relleno", "visibility", estado.depto && !verCali ? "visible" : "none");
  mapa.setLayoutProperty("muni-linea", "visibility", estado.depto && !verCali ? "visible" : "none");
  mapa.setLayoutProperty("zona-relleno", "visibility", verCali ? "visible" : "none");
  mapa.setLayoutProperty("zona-linea", "visibility", verCali ? "visible" : "none");
  mapa.setLayoutProperty("puntos", "visibility", verCali ? "visible" : "none");

  if (verPais) {
    mapa.flyTo({ center: [-74.3, 4.6], zoom: 4.4 });
    return;
  }

  const feats = municipiosDelDepto();
  const cuentas = {};
  datos.heat.puestos.forEach((p, i) => {
    if (p.depto !== estado.depto || !p.municipio_geo) return;
    const personas = conteo(i)[0];
    if (personas) cuentas[p.municipio_geo] = (cuentas[p.municipio_geo] || 0) + personas;
  });
  const max = Math.max(1, ...Object.values(cuentas));
  feats.forEach((ft) => {
    const personas = cuentas[ft.properties.MPIO_CNMBR] || 0;
    ft.properties.personas = personas;
    ft.properties.color = color(personas, max);
    ft.properties.sel = estado.muni && (ft.properties.MPIO_CNMBR === estado.muni || normLocal(ft.properties.MPIO_CNMBR) === normLocal(estado.muni)) ? 1 : 0;
  });
  mapa.getSource("muni").setData({ type: "FeatureCollection", features: feats });

  if (verCali) {
    const porZona = {};
    datos.heat.puestos.forEach((p, i) => {
      if (normLocal(p.municipio) !== "CALI" || !p.zona_id) return;
      const personas = conteo(i)[0];
      if (personas) porZona[p.zona_id] = (porZona[p.zona_id] || 0) + personas;
    });
    const maxZ = Math.max(1, ...Object.values(porZona));
    datos.cali.features.forEach((ft) => {
      const personas = porZona[ft.properties.zona_id] || 0;
      ft.properties.personas = personas;
      ft.properties.color = color(personas, maxZ);
      ft.properties.sel = estado.zona === ft.properties.zona_id ? 1 : 0;
    });
    mapa.getSource("zonas").setData(datos.cali);
    const puntos = [];
    datos.heat.puestos.forEach((p, i) => {
      if (normLocal(p.municipio) !== "CALI" || !p.lat) return;
      if (estado.zona && p.zona_id !== estado.zona) return;
      const personas = conteo(i)[0];
      if (!personas) return;
      puntos.push({
        type: "Feature",
        properties: { puesto: p.puesto, personas },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      });
    });
    mapa.getSource("puntos").setData({ type: "FeatureCollection", features: puntos });
    const zona = estado.zona && datos.cali.features.find((ft) => ft.properties.zona_id === estado.zona);
    encajar(zona ? [zona] : datos.cali.features, 28);
    return;
  }

  const elegido = estado.muni && feats.find((ft) => ft.properties.sel === 1);
  encajar(elegido ? [elegido] : feats, 28);
}

function pintarMigas() {
  const migas = document.getElementById("migas");
  const pasos = [["Colombia", null]];
  if (estado.depto) pasos.push([estado.depto, "depto"]);
  if (estado.muni) pasos.push([estado.muni, "muni"]);
  if (estado.zona) pasos.push([nombreZona(estado.zona), "zona"]);
  migas.innerHTML = pasos.map(([txt], i) => `<button type="button" data-i="${i}">${texto(txt)}</button>`).join("");
  migas.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      if (i === 0) { estado.depto = estado.muni = estado.zona = null; }
      else if (i === 1) { estado.muni = estado.zona = null; }
      else if (i === 2) estado.zona = null;
      estado.puesto = null;
      syncHash();
      dibujar();
    };
  });
}

function mostrarTabla() {
  const filas = puestosVisibles();
  const personas = filas.reduce((s, p) => s + p.personas, 0);
  const mesas = filas.reduce((s, p) => s + p.mesas, 0);
  const titulo = estado.zona ? nombreZona(estado.zona) : (estado.muni || estado.depto || "Colombia");
  document.getElementById("metricas").innerHTML = `
    <div><strong>${miles(personas)}</strong><span>personas</span></div>
    <div><strong>${miles(filas.length)}</strong><span>puestos</span></div>
    <div><strong>${miles(mesas)}</strong><span>mesas</span></div>`;
  const conPunto = filas.filter((p) => p.lat).length;
  const aviso = document.getElementById("aviso");
  if (esCali()) {
    const conPuntoTxt = conPunto === 1 ? "1 puesto tiene punto" : `${conPunto} puestos tienen punto`;
    aviso.textContent = `${titulo}. ${conPuntoTxt} en el mapa; el resto solo aparece en la tabla.`;
  } else if (estado.muni || estado.depto) {
    aviso.textContent = `Puestos de votación en ${titulo}.`;
  } else if (document.getElementById("buscar").value.trim()) {
    aviso.textContent = `${miles(filas.length)} puestos coinciden con la búsqueda.`;
  } else {
    aviso.textContent = "Elige un departamento en el mapa o en la lista.";
  }
  const totalesMpio = new Map();
  datos.heat.puestos.forEach((p, i) => {
    const n = conteo(i)[0];
    if (n) totalesMpio.set(p.municipio, (totalesMpio.get(p.municipio) || 0) + n);
  });
  const cuerpo = document.getElementById("tabla");
  const tope = estado.depto ? filas : filas.slice(0, 40);
  cuerpo.innerHTML = tope.map((p) => {
    const totalMpio = totalesMpio.get(p.municipio) || 0;
    const pctMpio = totalMpio ? (p.personas / totalMpio) * 100 : null;
    const cobertura = p.potencial ? (p.personas / p.potencial) * 100 : null;
    return `
    <tr data-i="${p.i}" class="${estado.puesto === p.puesto ? "activa" : ""}">
      <td class="puesto">${texto(p.puesto)}<small>${texto(p.municipio || "")}</small></td>
      <td>${texto(p.direccion || "")}</td>
      <td>${texto(p.zona || "")}</td>
      <td>${texto(p.comuna || "")}</td>
      <td class="num">${miles(p.mesas)}</td>
      <td class="num">${miles(p.personas)}</td>
      <td class="num">${decimal(pctMpio)}</td>
      <td class="num">${p.potencial ? miles(p.potencial) : ""}</td>
      <td class="num">${p.mesas_divpol ? miles(p.mesas_divpol) : ""}</td>
      <td class="num">${decimal(cobertura)}</td>
    </tr>`;
  }).join("");
  if (!estado.depto && filas.length > 40 && !document.getElementById("buscar").value.trim()) {
    aviso.textContent = "Mostrando 40 puestos. Entra a un departamento para ver el listado completo.";
  }
  cuerpo.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => {
      const item = datos.heat.puestos[Number(tr.dataset.i)];
      if (!item) return;
      const personas = conteo(Number(tr.dataset.i))[0];
      estado.depto = item.depto;
      estado.muni = item.municipio;
      estado.zona = item.zona_id || null;
      estado.puesto = item.puesto;
      syncHash();
      dibujar();
      if (item.lat) {
        mapa.flyTo({ center: [item.lon, item.lat], zoom: 14 });
        popup.setLngLat([item.lon, item.lat]).setHTML(`<b>${texto(item.puesto)}</b><br>${miles(personas)} personas`).addTo(mapa);
      }
    };
  });
}

document.getElementById("sel-lider").onchange = (ev) => {
  estado.lider = ev.target.value || null;
  estado.puesto = null;
  activarCorte();
  syncHash();
  dibujar();
};
document.getElementById("sel-depto").onchange = (ev) => {
  estado.depto = ev.target.value || null;
  estado.muni = estado.zona = estado.puesto = null;
  syncHash();
  dibujar();
};
document.getElementById("sel-muni").onchange = (ev) => {
  estado.muni = ev.target.value || null;
  estado.zona = estado.puesto = null;
  syncHash();
  dibujar();
};
document.getElementById("sel-zona").onchange = (ev) => {
  estado.zona = ev.target.value || null;
  estado.puesto = null;
  syncHash();
  dibujar();
};
document.getElementById("buscar").oninput = () => mostrarTabla();

cargar().catch((err) => {
  document.getElementById("aviso").textContent = "No se pudieron cargar los datos del mapa.";
  console.error(err);
});
