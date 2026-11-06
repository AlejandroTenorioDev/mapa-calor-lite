const estado = { depto: null, muni: null, zona: null, puesto: null };
let datos, mapa, popup;

const COLORES = ["#006837", "#1a9850", "#66bd63", "#a6d96a", "#d9ef8b", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026"];

function miles(n) {
  return Number(n || 0).toLocaleString("es-CO");
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
  datos = { heat, pais, muni, cali, porDepto };
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

function puestosVisibles() {
  return datos.heat.puestos.filter((p) => {
    if (estado.depto && p.depto !== estado.depto) return false;
    if (estado.muni && p.municipio !== estado.muni && p.municipio_geo !== estado.muni) return false;
    if (estado.zona && p.zona_id !== estado.zona) return false;
    const q = document.getElementById("buscar").value.trim().toLowerCase();
    if (!q) return true;
    return `${p.puesto} ${p.direccion} ${p.comuna}`.toLowerCase().includes(q);
  });
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
  const hash = partes.length ? "#/" + partes.join("/") : "#";
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function aplicarHash() {
  const partes = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  estado.depto = partes[0] || null;
  estado.muni = partes[1] || null;
  estado.zona = partes[2] || null;
  if (mapa && mapa.getSource("muni")) dibujar();
}

function pintarControles() {
  const selD = document.getElementById("sel-depto");
  const selM = document.getElementById("sel-muni");
  const selZ = document.getElementById("sel-zona");
  selD.innerHTML = `<option value="">Colombia</option>` + datos.heat.departamentos
    .map((d) => `<option value="${d.id}">${d.id} (${miles(d.personas)})</option>`).join("");
  const munis = datos.heat.municipios.filter((m) => !estado.depto || m.depto === estado.depto);
  selM.innerHTML = `<option value="">Todos</option>` + munis
    .map((m) => `<option value="${m.nombre}">${m.nombre} (${miles(m.personas)})</option>`).join("");
  selM.disabled = !estado.depto;
  const zonas = {};
  if (esCali()) {
    datos.heat.puestos.filter((p) => normLocal(p.municipio) === "CALI" && p.zona_id).forEach((p) => {
      zonas[p.zona_id] = (zonas[p.zona_id] || 0) + p.personas;
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
  datos.heat.municipios.filter((m) => m.depto === estado.depto).forEach((m) => {
    if (m.geo) cuentas[m.geo] = m.personas;
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
    datos.heat.puestos.filter((p) => normLocal(p.municipio) === "CALI").forEach((p) => {
      if (p.zona_id) porZona[p.zona_id] = (porZona[p.zona_id] || 0) + p.personas;
    });
    const maxZ = Math.max(1, ...Object.values(porZona));
    datos.cali.features.forEach((ft) => {
      const personas = porZona[ft.properties.zona_id] || 0;
      ft.properties.personas = personas;
      ft.properties.color = color(personas, maxZ);
      ft.properties.sel = estado.zona === ft.properties.zona_id ? 1 : 0;
    });
    mapa.getSource("zonas").setData(datos.cali);
    const puntos = datos.heat.puestos
      .filter((p) => normLocal(p.municipio) === "CALI" && p.lat && (!estado.zona || p.zona_id === estado.zona))
      .map((p) => ({
        type: "Feature",
        properties: { puesto: p.puesto, personas: p.personas },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      }));
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
  const cuerpo = document.getElementById("tabla");
  const tope = estado.depto ? filas : filas.slice(0, 40);
  cuerpo.innerHTML = tope.map((p) => `
    <tr data-puesto="${encodeURIComponent(p.puesto)}" class="${estado.puesto === p.puesto ? "activa" : ""}">
      <td class="puesto">${texto(p.puesto)}<small>${texto([p.municipio, p.comuna, p.direccion].filter(Boolean).join(" · "))}</small></td>
      <td class="num">${miles(p.personas)}</td>
      <td class="num">${miles(p.mesas)}</td>
    </tr>`).join("");
  if (!estado.depto && filas.length > 40 && !document.getElementById("buscar").value.trim()) {
    aviso.textContent = "Mostrando 40 puestos. Entra a un departamento para ver el listado completo.";
  }
  cuerpo.querySelectorAll("tr").forEach((tr) => {
    tr.onclick = () => {
      const puesto = decodeURIComponent(tr.dataset.puesto);
      const item = datos.heat.puestos.find((p) => p.puesto === puesto);
      if (!item) return;
      estado.depto = item.depto;
      estado.muni = item.municipio;
      estado.zona = item.zona_id || null;
      estado.puesto = item.puesto;
      syncHash();
      dibujar();
      if (item.lat) {
        mapa.flyTo({ center: [item.lon, item.lat], zoom: 14 });
        popup.setLngLat([item.lon, item.lat]).setHTML(`<b>${texto(item.puesto)}</b><br>${miles(item.personas)} personas`).addTo(mapa);
      }
    };
  });
}

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
