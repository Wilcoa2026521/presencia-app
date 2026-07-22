/* =========================================================
   PRESENCIA — Control de asistencia con reconocimiento facial
   Propiedad de: Wilmar Colorado Arenas
   © 2026 Wilmar Colorado Arenas. Todos los derechos reservados.

   Software entregado como servicio bajo licencia y hospedado por el
   propietario. Prohibido el uso, copia, distribución, modificación,
   ingeniería inversa o explotación comercial de este código sin
   autorización previa y por escrito del autor. El acceso de cada
   empresa cliente se controla mediante usuario y contraseña validados
   en el servidor (Code.gs, hojas "Empresas" y "Sesiones"), y puede ser
   revocado por el propietario en cualquier momento.
   ========================================================= */

// IMPORTANTE (solo lo edita Wilmar antes de publicar la app):
// pegá acá la URL de tu implementación de Google Apps Script.
// Los clientes finales nunca necesitan ver ni tocar este valor.
const SCRIPT_URL = "Phttps://script.google.com/macros/s/AKfycbw6ckUDPJIfYpstXW642wvpgDNu7pDxlImI1NnbymJeXEbsUB5J157bbl5G5oBAWC5w_A/exec";

const COOLDOWN_MS = 60 * 1000;
const CONFIRM_FRAMES = 3;
const DEFAULT_PIN = "1234";
const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

const state = {
  pin: localStorage.getItem("fichar_pin") || DEFAULT_PIN,
  threshold: parseFloat(localStorage.getItem("fichar_threshold") || "0.5"),
  employees: JSON.parse(localStorage.getItem("fichar_employees_cache") || "[]"),
  faceMatcher: null,
  cooldowns: {},
  matchStreak: { name: null, count: 0 },
  adminUnlocked: false,
  captureBuffer: [],
  activity: [],
  modelsReady: false,
  token: localStorage.getItem("fichar_token") || "",
  empresaId: localStorage.getItem("fichar_empresa_id") || "",
  empresaNombre: localStorage.getItem("fichar_empresa_nombre") || "",
};

const $ = (id) => document.getElementById(id);

function showToast(msg, ms = 2200) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function setRingState(mode) {
  const ring = $("ring");
  ring.classList.remove("idle", "success", "warn");
  ring.classList.add(mode);
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.remove("active"));
  $("view-" + name).classList.add("active");
  document.querySelector(`.navbtn[data-view="${name}"]`).classList.add("active");
}

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  $("clock").firstChild.textContent = `${hh}:${mm}:${ss}`;
  $("clockDate").textContent = `${dias[now.getDay()]} ${now.getDate()} ${meses[now.getMonth()]}`;
}
setInterval(tickClock, 1000);
tickClock();

const SESSION_ERRORS = ["sesión inválida", "sesión expirada", "acceso revocado", "empresa no encontrada"];
function isSessionError(resp) {
  return resp && resp.ok === false && SESSION_ERRORS.includes(resp.error);
}

async function apiPost(payload) {
  const body = Object.assign({}, payload);
  if (body.action !== "login") body.token = state.token;
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (isSessionError(data)) forceLogout(data.error);
  return data;
}

async function apiGetEmpleados() {
  const res = await fetch(SCRIPT_URL + "?action=empleados&token=" + encodeURIComponent(state.token));
  const data = await res.json();
  if (isSessionError(data)) forceLogout(data.error);
  return data;
}

async function syncEmployees() {
  try {
    const data = await apiGetEmpleados();
    if (data.empleados) {
      state.employees = data.empleados;
      localStorage.setItem("fichar_employees_cache", JSON.stringify(state.employees));
      buildFaceMatcher();
      renderEmployeeList();
      showToast(`Sincronizado: ${state.employees.length} empleados`);
    }
  } catch (err) {
    console.error(err);
    showToast("No se pudo sincronizar con el servidor");
  }
}

$("loginBtn").addEventListener("click", async () => {
  const usuario = $("loginUser").value.trim();
  const password = $("loginPass").value;
  if (!usuario || !password) return showToast("Completá usuario y contraseña");
  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Ingresando…";
  try {
    const resp = await apiPost({ action: "login", usuario, password });
    if (resp.ok) {
      state.token = resp.token;
      state.empresaId = resp.empresaId;
      state.empresaNombre = resp.empresaNombre || usuario;
      localStorage.setItem("fichar_token", state.token);
      localStorage.setItem("fichar_empresa_id", state.empresaId);
      localStorage.setItem("fichar_empresa_nombre", state.empresaNombre);
      $("topEyebrow").textContent = state.empresaNombre;
      $("empresaTitle").textContent = state.empresaNombre;
      $("loginScreen").classList.add("hidden");
      showToast(`Bienvenido, ${state.empresaNombre}`);
      await finishBoot();
    } else {
      showToast(mensajeLogin(resp.error));
    }
  } catch (err) {
    console.error(err);
    showToast("No se pudo conectar con el servidor");
  } finally {
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Ingresar";
  }
});

function mensajeLogin(error) {
  if (error === "usuario no encontrado") return "Usuario no encontrado";
  if (error === "contraseña incorrecta") return "Contraseña incorrecta";
  if (error === "empresa inactiva") return "Tu acceso fue desactivado. Contactá a Wilmar Colorado Arenas.";
  return "No se pudo iniciar sesión";
}

function forceLogout(motivo) {
  state.token = "";
  state.empresaId = "";
  state.empresaNombre = "";
  localStorage.removeItem("fichar_token");
  localStorage.removeItem("fichar_empresa_id");
  localStorage.removeItem("fichar_empresa_nombre");
  $("topEyebrow").textContent = "Control horario";
  $("loginScreen").classList.remove("hidden");
  switchView("fichar");
  if (motivo) showToast("Sesión finalizada: " + motivo);
}

$("logoutBtn").addEventListener("click", async () => {
  try { await apiPost({ action: "logout" }); } catch (e) {}
  forceLogout();
});

function buildFaceMatcher() {
  if (!state.employees.length) {
    state.faceMatcher = null;
    return;
  }
  const labeled = state.employees.map(
    (e) => new faceapi.LabeledFaceDescriptors(e.nombre, [new Float32Array(e.descriptor)])
  );
  state.faceMatcher = new faceapi.FaceMatcher(labeled, state.threshold);
}

async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  state.modelsReady = true;
}

async function startCamera() {
  const video = $("video");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 480, height: 480 },
    audio: false,
  });
  video.srcObject = stream;
  return new Promise((resolve) => (video.onloadedmetadata = resolve));
}

function detectorOptions() {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
}

async function detectionLoop() {
  const video = $("video");
  const overlay = $("overlay");
  if (video.readyState === 4) {
    const result = await faceapi
      .detectSingleFace(video, detectorOptions())
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    drawOverlay(overlay, video, result);

    if (result) {
      await handleDetection(result.descriptor);
    } else {
      state.matchStreak = { name: null, count: 0 };
      if (!captureModeActive()) {
        setRingState("idle");
        $("statusTitle").textContent = "Colocá tu rostro frente a la cámara";
        $("statusSub").textContent = "Buscando rostro…";
        $("tagWrap").innerHTML = "";
      }
    }
  }
  requestAnimationFrame(detectionLoop);
}

function drawOverlay(canvas, video, result) {
  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (result) {
    const { x, y, width, height } = result.detection.box;
    ctx.strokeStyle = "rgba(94,234,212,0.9)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);
  }
}

function captureModeActive() {
  return $("captureBtn") && $("captureBtn").dataset.capturing === "1";
}

async function handleDetection(descriptor) {
  if (captureModeActive()) return;

  if (!state.faceMatcher) {
    setRingState("idle");
    $("statusTitle").textContent = "Todavía no hay empleados cargados";
    $("statusSub").textContent = "Andá a Admin y agregá el primer empleado";
    return;
  }

  const best = state.faceMatcher.findBestMatch(descriptor);

  if (best.label === "unknown") {
    state.matchStreak = { name: null, count: 0 };
    setRingState("idle");
    $("statusTitle").textContent = "Rostro no reconocido";
    $("statusSub").textContent = "Pedile al administrador que te registre";
    $("tagWrap").innerHTML = "";
    return;
  }

  if (state.matchStreak.name === best.label) {
    state.matchStreak.count++;
  } else {
    state.matchStreak = { name: best.label, count: 1 };
  }

  setRingState("idle");
  $("statusTitle").textContent = `Hola, ${best.label}`;
  $("statusSub").textContent = "Confirmando identidad…";

  if (state.matchStreak.count < CONFIRM_FRAMES) return;

  const now = Date.now();
  if (state.cooldowns[best.label] && state.cooldowns[best.label] > now) {
    const seg = Math.ceil((state.cooldowns[best.label] - now) / 1000);
    $("statusSub").textContent = `Ya fichaste hace instantes. Esperá ${seg}s`;
    return;
  }

  state.matchStreak = { name: null, count: 0 };
  state.cooldowns[best.label] = now + COOLDOWN_MS;
  await registrarMarca(best.label);
}

async function registrarMarca(nombre) {
  $("statusSub").textContent = "Guardando en Google Sheets…";
  try {
    const resp = await apiPost({ action: "marcar", nombre });
    if (!resp.ok) throw new Error(resp.error || "error desconocido");
    const esEntrada = resp.tipo === "Entrada";
    setRingState(esEntrada ? "success" : "warn");
    $("statusTitle").textContent = `${nombre}`;
    $("statusSub").textContent = `${resp.tipo} registrada · ${resp.hora}`;
    $("tagWrap").innerHTML = `<span class="tag ${esEntrada ? "entrada" : "salida"}">${resp.tipo.toUpperCase()} · ${resp.hora}</span>`;
    addActivity(nombre, resp.tipo, resp.hora);
    setTimeout(() => setRingState("idle"), 3000);
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar la marca. Revisá la conexión.");
    setRingState("idle");
  }
}

function addActivity(nombre, tipo, hora) {
  state.activity.unshift({ nombre, tipo, hora });
  state.activity = state.activity.slice(0, 8);
  renderActivity();
}

function renderActivity() {
  const box = $("activityList");
  if (!state.activity.length) {
    box.innerHTML = `<div class="empty-hint">Todavía no hay marcas registradas hoy.</div>`;
    return;
  }
  box.innerHTML = state.activity
    .map(
      (a) => `
      <div class="activity-item">
        <div>
          <div class="who">${a.nombre}</div>
          <div class="when">${a.tipo}</div>
        </div>
        <div class="when">${a.hora}</div>
      </div>`
    )
    .join("");
}

$("captureBtn").addEventListener("click", async () => {
  if (!state.modelsReady) return showToast("Los modelos todavía están cargando");
  const btn = $("captureBtn");
  btn.dataset.capturing = "1";
  state.captureBuffer = [];
  updateCaptureDots();
  $("enrollStatus").textContent = "Mirá a la cámara y quedate quieto…";

  const video = $("video");
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const result = await faceapi
      .detectSingleFace(video, detectorOptions())
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (result) {
      state.captureBuffer.push(Array.from(result.descriptor));
      updateCaptureDots();
    } else {
      i--;
      $("enrollStatus").textContent = "No veo tu rostro, acercate un poco…";
    }
  }
  btn.dataset.capturing = "0";
  $("enrollStatus").textContent = "Captura lista. Escribí el nombre y guardá.";
  $("saveEmpBtn").disabled = !$("empName").value.trim();
});

$("empName").addEventListener("input", () => {
  $("saveEmpBtn").disabled = state.captureBuffer.length !== 3 || !$("empName").value.trim();
});

function updateCaptureDots() {
  const dots = $("captureDots").children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("done", i < state.captureBuffer.length);
  }
}

function averageDescriptors(list) {
  const len = list[0].length;
  const avg = new Array(len).fill(0);
  list.forEach((d) => d.forEach((v, i) => (avg[i] += v / list.length)));
  return avg;
}

$("saveEmpBtn").addEventListener("click", async () => {
  const nombre = $("empName").value.trim();
  if (!nombre || state.captureBuffer.length !== 3) return;
  $("saveEmpBtn").disabled = true;
  $("saveEmpBtn").textContent = "Guardando…";
  try {
    const descriptor = averageDescriptors(state.captureBuffer);
    const resp = await apiPost({ action: "registrar_empleado", nombre, descriptor });
    if (!resp.ok) throw new Error(resp.error || "error");
    showToast(`${nombre} agregado correctamente`);
    $("empName").value = "";
    state.captureBuffer = [];
    updateCaptureDots();
    $("enrollStatus").textContent = "Escribí el nombre y capturá el rostro";
    await syncEmployees();
  } catch (err) {
    console.error(err);
    showToast("No se pudo guardar el empleado");
  } finally {
    $("saveEmpBtn").disabled = true;
    $("saveEmpBtn").textContent = "Guardar empleado";
  }
});

function renderEmployeeList() {
  const card = $("employeeListCard");
  $("empCount").textContent = state.employees.length ? `(${state.employees.length})` : "";
  if (!state.employees.length) {
    card.innerHTML = `<div class="empty-hint">Sin empleados todavía.</div>`;
    return;
  }
  card.innerHTML = state.employees
    .map(
      (e) => `
      <div class="employee-row">
        <div>
          <div class="name">${e.nombre}</div>
          <div class="meta">ID ${String(e.id).slice(0, 8)}</div>
        </div>
        <button class="btn-danger" data-id="${e.id}">Eliminar</button>
      </div>`
    )
    .join("");
  card.querySelectorAll(".btn-danger").forEach((b) =>
    b.addEventListener("click", () => eliminarEmpleado(b.dataset.id))
  );
}

async function eliminarEmpleado(id) {
  if (!confirm("¿Eliminar este empleado?")) return;
  try {
    const resp = await apiPost({ action: "eliminar_empleado", id });
    if (!resp.ok) throw new Error(resp.error || "error");
    showToast("Empleado eliminado");
    await syncEmployees();
  } catch (err) {
    console.error(err);
    showToast("No se pudo eliminar");
  }
}

document.querySelectorAll(".navbtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    if (target === "admin" && !state.adminUnlocked) {
      $("pinScreen").classList.remove("hidden");
      $("pinInput").value = "";
      $("pinInput").focus();
      return;
    }
    switchView(target);
  });
});

$("pinBtn").addEventListener("click", () => {
  if ($("pinInput").value === state.pin) {
    state.adminUnlocked = true;
    $("pinScreen").classList.add("hidden");
    switchView("admin");
  } else {
    showToast("PIN incorrecto");
  }
});
$("pinCancelBtn").addEventListener("click", () => {
  $("pinScreen").classList.add("hidden");
  switchView("fichar");
});
$("lockBtn").addEventListener("click", () => {
  state.adminUnlocked = false;
  switchView("fichar");
});

$("refreshBtn").addEventListener("click", syncEmployees);

$("threshold").addEventListener("change", () => {
  const v = parseFloat($("threshold").value);
  if (!isNaN(v) && v > 0 && v < 1) {
    state.threshold = v;
    localStorage.setItem("fichar_threshold", String(v));
    buildFaceMatcher();
    showToast("Umbral actualizado");
  }
});

async function boot() {
  $("threshold").value = state.threshold;
  buildFaceMatcher();
  renderEmployeeList();

  if (!state.token) {
    $("loginScreen").classList.remove("hidden");
    $("loadingScreen").classList.add("hidden");
    return;
  }

  $("topEyebrow").textContent = state.empresaNombre || "Control horario";
  $("empresaTitle").textContent = state.empresaNombre || "Empresa";
  $("loginScreen").classList.add("hidden");
  await finishBoot();
}

async function finishBoot() {
  try {
    await loadModels();
    await startCamera();
  } catch (err) {
    console.error(err);
    $("statusTitle").textContent = "No se pudo acceder a la cámara";
    $("statusSub").textContent = "Revisá los permisos del navegador";
  }
  $("loadingScreen").classList.add("hidden");
  await syncEmployees();
  detectionLoop();
}

window.addEventListener("load", boot);
